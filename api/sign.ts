/**
 * POST /api/sign  { handle: string }
 *
 * Turns a web form into a git commit. The page is fully static, so this function is the
 * only place a write can happen - and the only place the GitHub token exists.
 *
 * Flow: validate shape -> confirm the account exists -> confirm it has not already
 * signed -> commit `src/data/signers/<handle>.json`. Vercel's auto-build on push to
 * `main` then re-renders the wall, roughly a minute later.
 *
 * Env:
 *   GITHUB_TOKEN  (required)  fine-grained PAT, this repo only, `Contents: write`.
 *                            MUST NOT be PUBLIC_-prefixed or it lands in the client bundle.
 *   SIGN_MODE     'commit' (default) | 'pr'  - `pr` opens a pull request instead of
 *                            committing to main, restoring per-signature approval.
 *   GITHUB_OWNER / GITHUB_REPO / GITHUB_BRANCH  optional overrides.
 */
import type { SignResponse } from '../src/components/signManifesto';

const OWNER = process.env.GITHUB_OWNER ?? 'am0wa';
const REPO = process.env.GITHUB_REPO ?? 'bakeit';
const BRANCH = process.env.GITHUB_BRANCH ?? 'main';
const SIGNERS_DIR = 'src/data/signers';
const API = 'https://api.github.com';

/** Blast-radius limit, not a real rate limiter - see the plan's honest scorecard. */
const MAX_NEW_PER_HOUR = 30;

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

/** base64 without Buffer, so this stays portable across runtimes. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ status: 'error', message: 'Use POST.' }, 405);
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

  try {
    // 1. Does the account exist? Authenticated: 5,000/hr rather than 60/hr.
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

    // 2. One directory listing answers both "already signed?" and "how many total?".
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

    // 3. Blast-radius cap: if the signers path is being hammered, stop writing.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const commitsRes = await gh(
      `/repos/${OWNER}/${REPO}/commits?path=${encodeURIComponent(SIGNERS_DIR)}` +
        `&since=${since}&per_page=100&sha=${BRANCH}`,
      token,
    );
    if (commitsRes.ok) {
      const recent = (await commitsRes.json()) as unknown[];
      if (recent.length >= MAX_NEW_PER_HOUR) {
        return json({
          status: 'throttled',
          message: 'A lot of people are signing right now — try again in a bit.',
        });
      }
    }

    // 4. Write.
    const signature = {
      handle: canonical,
      id: user.id,
      name: user.name ?? undefined,
      at: new Date().toISOString(),
    };
    const content = toBase64(`${JSON.stringify(signature, null, 2)}\n`);
    const total = jsonFiles.length + 1;
    const mode = process.env.SIGN_MODE === 'pr' ? 'pr' : 'commit';

    if (mode === 'pr') {
      const prMessage = await openPullRequest(token, canonical, filePath, content);
      return json({ status: 'ok', handle: canonical, total, message: prMessage });
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

    return json({ status: 'ok', handle: canonical, total });
  } catch (error) {
    console.error('[sign]', error);
    return json(
      { status: 'error', message: 'Signing is having a moment — try again in a bit.' },
      502,
    );
  }
}

/** SIGN_MODE=pr: branch + commit + PR, so each signature needs an explicit merge. */
async function openPullRequest(
  token: string,
  handle: string,
  filePath: string,
  content: string,
): Promise<string> {
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
  if (prRes.ok) return 'Ur signature is queued for review.';
  if (prRes.status === 422) return 'Ur signature is already queued for review.';
  throw new Error(`pr failed: ${prRes.status}`);
}
