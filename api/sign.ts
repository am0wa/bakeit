/**
 * GET /api/sign — GitHub OAuth sign-in that turns an authenticated identity into a
 * signature pull request.
 *
 * Two entry points, both GET on this one function:
 *   (no code)        → mint a signed `state` and 302 to GitHub's authorize page
 *   ?code=…&state=…  → OAuth callback: verify state, exchange the code, ask GitHub who
 *                      the caller is, and open the signature PR for THAT handle
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────┐
 * │ THE SIGNER'S HANDLE COMES ONLY FROM `GET /user`.                                 │
 * │ Never from a query parameter, never from a body. That one rule is what makes a   │
 * │ signature authentic - the previous POST endpoint accepted a typed handle, so      │
 * │ anyone could sign as anyone. Do not reintroduce a caller-supplied handle.        │
 * └──────────────────────────────────────────────────────────────────────────────────┘
 *
 * Two credentials, two jobs - do not conflate them:
 *   - The OAuth *user* token establishes IDENTITY. Never stored, logged, or returned.
 *   - GITHUB_TOKEN (the PAT) supplies AUTHORITY: a visitor's own token has no write
 *     access to this repo, so the PAT is what actually creates the branch and PR.
 *
 * Env:
 *   GITHUB_TOKEN                (required) fine-grained PAT: Contents + Pull requests write
 *   GITHUB_OAUTH_CLIENT_ID      (required) OAuth App client id (public)
 *   GITHUB_OAUTH_CLIENT_SECRET  (required) OAuth App secret; doubles as the HMAC key for `state`
 *   SIGN_MODE                   'pr' (default) | 'commit'
 *   GITHUB_OWNER / GITHUB_REPO / GITHUB_BRANCH   optional overrides
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const OWNER = process.env.GITHUB_OWNER ?? 'am0wa';
const REPO = process.env.GITHUB_REPO ?? 'bakeit';
const BRANCH = process.env.GITHUB_BRANCH ?? 'main';
const SIGNERS_DIR = 'src/data/signers';
const API = 'https://api.github.com';

/** Where the visitor is sent back to, and the callback GitHub must be configured with. */
const SITE = 'https://www.bakeit.dev';
const RETURN_PATH = '/learn/am0wa-manifesto/';
const CALLBACK_URL = `${SITE}/api/sign`;

/** `state` lifetime. Long enough to read GitHub's authorize screen, short enough to bound replay. */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Blast-radius limits. Neither is a real rate limiter - they cap the mess so cleanup
 * stays cheap. Both are global: a stateless function has no store to key an IP off.
 *
 * The metric must match the mode. In PR mode signatures live on `sign/*` branches and
 * never touch the base branch until merged, so counting commits there measures NOTHING.
 * Count the review queue instead.
 */
const MAX_NEW_PER_HOUR = 30; // commit mode: commits on the base branch, per hour
const MAX_PENDING_PRS = 25; // PR mode: open signature PRs. Keep < 100 (see per_page).

// ─── helpers ────────────────────────────────────────────────────────────────────

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location, 'cache-control': 'no-store' } });
}

/** Send the visitor back to the manifesto with a result the page can render. */
function back(result: string, handle?: string): Response {
  const q = new URLSearchParams({ sign: result });
  if (handle) q.set('as', handle);
  return redirect(`${SITE}${RETURN_PATH}?${q}`);
}

function fail(message: string, status: number): Response {
  return new Response(JSON.stringify({ status: 'error', message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const b64url = (b: Buffer) => b.toString('base64url');

/**
 * Stateless CSRF `state`: `<nonce>.<issuedAt>.<hmac>`. Without this an attacker could
 * craft a link that signs the manifesto as whoever clicks it - precisely the harm OAuth
 * is here to remove. No cookie and no store needed, because the signature proves we
 * minted it and the timestamp bounds replay.
 */
function mintState(secret: string): string {
  const payload = `${b64url(randomBytes(16))}.${Date.now()}`;
  return `${payload}.${b64url(createHmac('sha256', secret).update(payload).digest())}`;
}

type StateCheck = 'ok' | 'forged' | 'expired';

function checkState(secret: string, state: string | null): StateCheck {
  if (!state) return 'forged';
  const parts = state.split('.');
  if (parts.length !== 3) return 'forged';
  const [nonce, issued, sig] = parts;
  const expected = b64url(createHmac('sha256', secret).update(`${nonce}.${issued}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return 'forged';
  const ts = Number(issued);
  if (!Number.isFinite(ts) || Date.now() - ts > STATE_TTL_MS) return 'expired';
  return 'ok';
}

/** Authenticated GitHub API call. `token` is the PAT unless stated otherwise. */
function gh(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'bakeit-manifesto-signer',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
}

interface GhUser {
  login: string;
  id: number;
  name: string | null;
}
interface GhEntry {
  name: string;
  type: string;
}

/** base64 without relying on Buffer semantics for the content itself. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Is the queue (or commit rate) already at its cap? Fails OPEN: a GitHub hiccup must not
 * block legitimate signing, and a missed cap only costs noise that is cheap to clear.
 */
async function overCapacity(token: string, mode: 'pr' | 'commit'): Promise<boolean> {
  if (mode === 'commit') {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const res = await gh(
      `/repos/${OWNER}/${REPO}/commits?path=${encodeURIComponent(SIGNERS_DIR)}` +
        `&since=${since}&per_page=100&sha=${BRANCH}`,
      token,
    );
    if (!res.ok) return false;
    return ((await res.json()) as unknown[]).length >= MAX_NEW_PER_HOUR;
  }

  // No pagination needed: MAX_PENDING_PRS < per_page, so a full first page is already over.
  const res = await gh(
    `/repos/${OWNER}/${REPO}/pulls?state=open&base=${BRANCH}&per_page=100`,
    token,
  );
  if (!res.ok) return false;
  const open = (await res.json()) as { head?: { ref?: string } }[];
  // Match the BRANCH PREFIX our own code sets, not the PR title, which is renameable.
  return open.filter((pr) => pr.head?.ref?.startsWith('sign/')).length >= MAX_PENDING_PRS;
}

// ─── handler ────────────────────────────────────────────────────────────────────

/**
 * A NAMED METHOD EXPORT, not `export default`. Vercel's Node runtime only takes the
 * Web-handler path when a module exports `fetch` or a named HTTP method; a bare default
 * export is treated as a legacy `(req, res)` handler, receives an `IncomingMessage`, and
 * hangs to a 504 instead of failing loudly. This also gives a 405 on POST for free -
 * which is deliberate: the old POST endpoint was the impersonation vector.
 */
export async function GET(request: Request): Promise<Response> {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const token = process.env.GITHUB_TOKEN;
  if (!clientId || !clientSecret || !token) {
    // Log for us, stay generic for the caller: never hint at which value is missing.
    console.error('[sign] missing env:', {
      clientId: Boolean(clientId),
      clientSecret: Boolean(clientSecret),
      token: Boolean(token),
    });
    return fail('Signing is misconfigured.', 500);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  // ── entry point 1: begin the flow ────────────────────────────────────────────
  if (!code) {
    const authorize = new URL('https://github.com/login/oauth/authorize');
    authorize.searchParams.set('client_id', clientId);
    authorize.searchParams.set('redirect_uri', CALLBACK_URL);
    authorize.searchParams.set('state', mintState(clientSecret));
    // No `scope`: we only need the caller's public identity, and GET /user returns it.
    // Deliberately no email scope.
    return redirect(authorize.toString());
  }

  // ── entry point 2: OAuth callback ────────────────────────────────────────────
  const state = checkState(clientSecret, url.searchParams.get('state'));
  // A malformed or wrongly-signed state cannot come from a real visitor - answer bluntly.
  // A correctly-signed but stale one can (they left the authorize screen open), so send
  // them back to the page with something readable.
  if (state === 'forged') return fail('Bad state.', 400);
  if (state === 'expired') return back('expired');

  try {
    // 1. Exchange the code. This is the only step needing the client secret.
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: CALLBACK_URL,
      }),
    });
    if (!tokenRes.ok) throw new Error(`code exchange failed: ${tokenRes.status}`);
    const grant = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!grant.access_token) throw new Error(`code exchange error: ${grant.error ?? 'no token'}`);

    // 2. Who is this? The ONLY source of the signer's identity.
    const meRes = await gh('/user', grant.access_token);
    if (!meRes.ok) throw new Error(`identity lookup failed: ${meRes.status}`);
    const me = (await meRes.json()) as GhUser;
    const canonical = me.login;
    const fileName = `${canonical.toLowerCase()}.json`;
    const filePath = `${SIGNERS_DIR}/${fileName}`;

    const mode = process.env.SIGN_MODE === 'commit' ? 'commit' : 'pr';

    // 3. Capacity before any further work.
    if (await overCapacity(token, mode)) return back('busy');

    // 4. One directory listing answers both "already signed?" and "how many total?".
    const dirRes = await gh(`/repos/${OWNER}/${REPO}/contents/${SIGNERS_DIR}?ref=${BRANCH}`, token);
    let existing: GhEntry[] = [];
    if (dirRes.ok) {
      existing = (await dirRes.json()) as GhEntry[];
    } else if (dirRes.status !== 404) {
      throw new Error(`dir listing failed: ${dirRes.status}`);
    }
    const jsonFiles = existing.filter((e) => e.type === 'file' && e.name.endsWith('.json'));
    if (jsonFiles.some((e) => e.name.toLowerCase() === fileName)) {
      return back('already', canonical);
    }

    // 5. Write. `cryptoSig` is never set here - see Signer's doc comment.
    const signature = {
      handle: canonical,
      id: me.id,
      name: me.name ?? undefined,
      at: new Date().toISOString(),
    };
    const content = toBase64(`${JSON.stringify(signature, null, 2)}\n`);

    if (mode === 'pr') {
      const outcome = await openPullRequest(token, canonical, filePath, content);
      return back(outcome === 'queued' ? 'queued' : 'already', canonical);
    }

    const putRes = await gh(`/repos/${OWNER}/${REPO}/contents/${filePath}`, token, {
      method: 'PUT',
      body: JSON.stringify({
        message: `signers: add @${canonical}`,
        content,
        branch: BRANCH,
      }),
    });
    if (!putRes.ok) {
      if (putRes.status === 409 || putRes.status === 422) return back('already', canonical);
      throw new Error(`commit failed: ${putRes.status}`);
    }
    return back('signed', canonical);
  } catch (error) {
    // Never surface the OAuth token, the code, or API detail.
    console.error('[sign]', error);
    return back('error');
  }
}

/**
 * SIGN_MODE=pr: branch + commit + PR, so each signature needs an explicit merge.
 * Returns which outcome occurred - a re-sign while a PR is still open must NOT be
 * reported to the visitor as a fresh signature.
 */
async function openPullRequest(
  token: string,
  handle: string,
  filePath: string,
  content: string,
): Promise<'queued' | 'already-queued'> {
  const branch = `sign/${handle.toLowerCase()}`;

  const baseRes = await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`, token);
  if (!baseRes.ok) throw new Error(`base ref failed: ${baseRes.status}`);
  const base = (await baseRes.json()) as { object: { sha: string } };

  const refRes = await gh(`/repos/${OWNER}/${REPO}/git/refs`, token, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }),
  });
  // 422 = the branch already exists, i.e. a signature is already awaiting review.
  if (!refRes.ok && refRes.status !== 422) throw new Error(`branch failed: ${refRes.status}`);

  const putRes = await gh(`/repos/${OWNER}/${REPO}/contents/${filePath}`, token, {
    method: 'PUT',
    body: JSON.stringify({ message: `signers: add @${handle}`, content, branch }),
  });
  if (!putRes.ok && putRes.status !== 422) throw new Error(`pr commit failed: ${putRes.status}`);

  const prRes = await gh(`/repos/${OWNER}/${REPO}/pulls`, token, {
    method: 'POST',
    body: JSON.stringify({
      title: `signers: add @${handle}`,
      head: branch,
      base: BRANCH,
      body: `@${handle} signed the Am0wA Manifesto via the website (GitHub OAuth).`,
    }),
  });
  if (prRes.ok) return 'queued';
  // 422 = a PR for this head/base is already open.
  if (prRes.status === 422) return 'already-queued';
  throw new Error(`pr failed: ${prRes.status}`);
}
