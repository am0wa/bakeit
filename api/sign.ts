/**
 * POST /api/sign  { handle: string }
 *
 * Turns a web form into a git contribution. The page is fully static, so this function is
 * the only place a write can happen - and the only place the GitHub token exists.
 *
 * Flow: validate shape -> confirm the account exists -> confirm it has not already
 * signed -> add `src/data/signers/<handle>.json`. By default that arrives as a PULL
 * REQUEST, so nothing reaches `main` (and no rebuild happens) until it is merged; the
 * wall re-renders on the build that the merge triggers.
 *
 * Env:
 *   GITHUB_TOKEN  (required)  fine-grained PAT, this repo only, `Contents: write`.
 *                            MUST NOT be PUBLIC_-prefixed or it lands in the client bundle.
 *   SIGN_MODE     'pr' (default) | 'commit'  - `pr` opens a pull request per signature
 *                            so nothing reaches `main` without an explicit merge; spam
 *                            cannot push to main or trigger a production rebuild.
 *                            Set 'commit' to write straight to main (instant, unmoderated).
 *   GITHUB_OWNER / GITHUB_REPO / GITHUB_BRANCH  optional overrides.
 */
import type { SignResponse } from '../src/components/signManifesto';

const OWNER = process.env.GITHUB_OWNER ?? 'am0wa';
const REPO = process.env.GITHUB_REPO ?? 'bakeit';
const BRANCH = process.env.GITHUB_BRANCH ?? 'main';
const SIGNERS_DIR = 'src/data/signers';
const API = 'https://api.github.com';

/**
 * Blast-radius limits. Neither is a real rate limiter - they cap the mess so cleanup
 * stays cheap. Both are global rather than per-visitor: a stateless function has no
 * store to key an IP off, and adding one is the infrastructure this design avoids.
 *
 * The metric has to match the mode. In PR mode signatures live on `sign/*` branches and
 * never touch the base branch until merged, so counting commits there measures NOTHING -
 * that was a real hole. Count the review queue instead.
 */
const MAX_NEW_PER_HOUR = 30; // commit mode: commits on the base branch, per hour
const MAX_PENDING_PRS = 25; // PR mode: open signature PRs. Keep < 100 (see per_page).

/**
 * GitHub's own username grammar. Deliberately duplicated from
 * `src/components/signManifesto.ts` rather than imported at runtime: this copy is the
 * authoritative one (the client's is only for fast feedback), and keeping the function
 * free of cross-directory runtime imports keeps its bundle trivially correct.
 * It also stops path traversal in the signature filename.
 */
const HANDLE_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

function normalizeHandle(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
    .replace(/^@+/, '')
    .replace(/\/+$/, '')
    .trim();
}

/**
 * Weak by construction: a script can omit or forge `Origin`, so this is NOT a control -
 * it only turns away casual cross-site embedding, for three lines and no dependency.
 * Absent header is allowed on purpose (curl, and some privacy tooling, send none).
 */
const ALLOWED_ORIGINS = ['https://www.bakeit.dev', 'https://bakeit.dev', 'http://localhost:4321'];

function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  return origin === null || ALLOWED_ORIGINS.includes(origin);
}

function json(body: SignResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

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

/**
 * Is the queue (or commit rate) already at its cap? Fails OPEN: a GitHub hiccup must not
 * block legitimate signing, and a missed cap only costs noise that is cheap to clear.
 */
async function overCapacity(token: string, mode: 'pr' | 'commit'): Promise<boolean> {
  if (mode === 'commit') {
    // Commits DO land on the base branch in this mode, so this measure is the right one.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const res = await gh(
      `/repos/${OWNER}/${REPO}/commits?path=${encodeURIComponent(SIGNERS_DIR)}` +
        `&since=${since}&per_page=100&sha=${BRANCH}`,
      token,
    );
    if (!res.ok) return false;
    return ((await res.json()) as unknown[]).length >= MAX_NEW_PER_HOUR;
  }

  // PR mode: count what actually accumulates - unmerged signature PRs. No pagination
  // needed because MAX_PENDING_PRS < per_page, so a full first page is already over.
  const res = await gh(
    `/repos/${OWNER}/${REPO}/pulls?state=open&base=${BRANCH}&per_page=100`,
    token,
  );
  if (!res.ok) return false;
  const open = (await res.json()) as { head?: { ref?: string } }[];
  // Match on the BRANCH PREFIX our own code sets, not the PR title, which is renameable.
  return open.filter((pr) => pr.head?.ref?.startsWith('sign/')).length >= MAX_PENDING_PRS;
}

/** base64 without Buffer, so this stays portable across runtimes. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * A NAMED METHOD EXPORT, not `export default`. Vercel's Node runtime only takes the
 * Web-handler path when a module exports `fetch` or a named HTTP method; a bare default
 * function is treated as a legacy `(req, res)` handler, so it would be called with an
 * `IncomingMessage`, the returned Response discarded, and the request left unanswered
 * until it times out (504) rather than failing loudly. This form also gives us a 405 on
 * every other method for free, which is why there is no method guard here.
 */
export async function POST(request: Request): Promise<Response> {
  // Origin first: it is the cheapest and most definitive rejection, it costs no config
  // and no network, and putting it ahead of the token check means a bad-origin request
  // never touches configuration (and cannot be masked by a misconfigured deployment).
  if (!originAllowed(request)) {
    return json({ status: 'error', message: 'Bad origin.' }, 403);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    // Log for us, stay generic for the client: never hint at config shape.
    console.error('[sign] GITHUB_TOKEN is not set');
    return json({ status: 'error', message: 'Signing is misconfigured.' }, 500);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ status: 'invalid_handle', message: 'Expected a JSON body.' }, 400);
  }

  const submitted =
    payload && typeof payload === 'object' && 'handle' in payload
      ? (payload as { handle?: unknown }).handle
      : undefined;
  const handle = normalizeHandle(typeof submitted === 'string' ? submitted : '');

  if (!HANDLE_RE.test(handle)) {
    return json(
      {
        status: 'invalid_handle',
        message: "That's not a GitHub username — letters, digits and dashes only.",
      },
      400,
    );
  }

  const mode = process.env.SIGN_MODE === 'commit' ? 'commit' : 'pr';

  try {
    // 1. Capacity FIRST, deliberately. Every request spends GitHub API calls from a
    // shared 5,000/hr token budget, and exhausting it breaks signing for everyone - so
    // once we are at the cap a flood must cost one call per request, not four.
    if (await overCapacity(token, mode)) {
      return json({
        status: 'throttled',
        message: 'There are a lot of signatures awaiting review — try again in a bit.',
      });
    }

    // 2. Does the account exist? Authenticated: 5,000/hr rather than 60/hr.
    const userRes = await gh(`/users/${encodeURIComponent(handle)}`, token);
    if (userRes.status === 404) {
      return json({
        status: 'unknown_handle',
        handle,
        message: `No GitHub user called @${handle}. Typo?`,
      });
    }
    if (!userRes.ok) throw new Error(`user lookup failed: ${userRes.status}`);
    const user = (await userRes.json()) as GhUser;

    // Canonical casing from GitHub; the filename is lowercased so handles that differ
    // only by case cannot produce two signatures.
    const canonical = user.login;
    const fileName = `${canonical.toLowerCase()}.json`;
    const filePath = `${SIGNERS_DIR}/${fileName}`;

    // 3. One directory listing answers both "already signed?" and "how many total?".
    const dirRes = await gh(
      `/repos/${OWNER}/${REPO}/contents/${SIGNERS_DIR}?ref=${BRANCH}`,
      token,
    );
    let existing: GhEntry[] = [];
    if (dirRes.ok) {
      existing = (await dirRes.json()) as GhEntry[];
    } else if (dirRes.status !== 404) {
      throw new Error(`dir listing failed: ${dirRes.status}`);
    }

    const jsonFiles = existing.filter((e) => e.type === 'file' && e.name.endsWith('.json'));
    if (jsonFiles.some((e) => e.name.toLowerCase() === fileName)) {
      return json({
        status: 'already_signed',
        handle: canonical,
        total: jsonFiles.length,
        message: `@${canonical} already signed.`,
      });
    }

    // 4. Write.
    const signature = {
      handle: canonical,
      id: user.id,
      name: user.name ?? undefined,
      at: new Date().toISOString(),
    };
    const content = toBase64(`${JSON.stringify(signature, null, 2)}\n`);

    if (mode === 'pr') {
      const outcome = await openPullRequest(token, canonical, filePath, content);
      return json({
        status: outcome === 'queued' ? 'ok' : 'already_signed',
        handle: canonical,
        // Unchanged on purpose: the signature is not on the wall until the PR is merged,
        // so bumping the count here would show a number the next page load contradicts.
        total: jsonFiles.length,
        message:
          outcome === 'queued'
            ? 'Ur signature is queued for review.'
            : 'Ur signature is already queued for review.',
      });
    }

    const total = jsonFiles.length + 1;

    const putRes = await gh(`/repos/${OWNER}/${REPO}/contents/${filePath}`, token, {
      method: 'PUT',
      body: JSON.stringify({
        message: `signers: add @${canonical}`,
        content,
        branch: BRANCH,
      }),
    });
    if (!putRes.ok) {
      // 409 means someone committed in between; the next attempt will see the file.
      if (putRes.status === 409 || putRes.status === 422) {
        return json({
          status: 'already_signed',
          handle: canonical,
          total: jsonFiles.length,
          message: `@${canonical} already signed.`,
        });
      }
      throw new Error(`commit failed: ${putRes.status}`);
    }

    return json({
      status: 'ok',
      handle: canonical,
      total,
      message: 'Ur name joins the wall in about a minute, once the site rebuilds.',
    });
  } catch (error) {
    console.error('[sign]', error);
    return json(
      { status: 'error', message: 'Signing is having a moment — try again in a bit.' },
      502,
    );
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
  if (!refRes.ok && refRes.status !== 422) {
    throw new Error(`branch failed: ${refRes.status}`);
  }

  const putRes = await gh(`/repos/${OWNER}/${REPO}/contents/${filePath}`, token, {
    method: 'PUT',
    body: JSON.stringify({ message: `signers: add @${handle}`, content, branch }),
  });
  if (!putRes.ok && putRes.status !== 422) {
    throw new Error(`pr commit failed: ${putRes.status}`);
  }

  const prRes = await gh(`/repos/${OWNER}/${REPO}/pulls`, token, {
    method: 'POST',
    body: JSON.stringify({
      title: `signers: add @${handle}`,
      head: branch,
      base: BRANCH,
      body: `@${handle} signed the Am0wA Manifesto via the website.`,
    }),
  });
  if (prRes.ok) return 'queued';
  // 422 = a PR for this head/base is already open.
  if (prRes.status === 422) return 'already-queued';
  throw new Error(`pr failed: ${prRes.status}`);
}
