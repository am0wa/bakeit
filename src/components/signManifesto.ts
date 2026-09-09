/**
 * Shared helpers for the manifesto signer wall.
 *
 * Imported by BOTH `SignManifesto.astro`'s frontmatter (build time) and its bundled
 * client script, so nothing here may touch the DOM at module scope. `must()` is the
 * only browser-only export and it is called from the script alone.
 */

/** One signature. Mirrors the shape of `src/data/signers/<handle>.json`. */
export interface Signer {
  /** GitHub login, canonical casing as returned by the API. */
  handle: string;
  /**
   * GitHub's numeric user id. Survives renames, so avatar URLs keyed on it never rot.
   * OPTIONAL because a hand-written signature (the one-click GitHub path) cannot know
   * it - `avatarUrl()` falls back to the handle.
   */
  id?: number;
  /** GitHub display name. USER-CONTROLLED - always render via `safeLabel()`. */
  name?: string;
  /**
   * ISO 8601 timestamp. OPTIONAL for the same reason: a hand-written file may omit it,
   * and a missing value must degrade the sort order rather than fail the build.
   */
  at?: string;
  /**
   * Reserved for a future crypto-signing step: a detached SSH signature over the fixed
   * statement `I sign the Am0wA Manifesto`, checkable with `ssh-keygen -Y verify`
   * against the signer's public keys at `https://github.com/<handle>.keys` (public, no
   * auth). The statement is fixed and the key is discoverable from the handle, so a bare
   * armored signature string is enough - no algorithm or key id needed alongside it.
   *
   * UNVALIDATED today, so render **no** "verified" badge from its presence: absence
   * means unsigned, presence means *unverified*. Note the web form can never set this -
   * the function holds no private key of the signer's - so only the one-click GitHub
   * path or a future CLI can supply one.
   */
  cryptoSig?: string;
}

/** Below this many signatures the wall renders larger - see `[data-cozy]`. */
export const COZY_MAX = 24;
/** Hard cap on rendered chips; the rest become "...and N more signers". */
export const MAX_RENDERED = 600;

const LABEL_URLISH = /(https?:|\/\/|www\.|t\.me|@)/i;
const LABEL_TLD =
  /\.(com|net|org|io|dev|ai|app|co|me|ru|cn|xyz|top|shop|club|info|biz|link|site|online|store|live|vip|pro|fun|icu)\b/i;
const LABEL_PROMO =
  /\b(free|cheap|casino|porn|viagra|seo|backlink|loan|crypto|bitcoin|airdrop|nft|forex|telegram|whatsapp|subscribe|follow|click|discount|promo|earn)\b/i;
const LABEL_PUNCT = /[<>{}[\]|\\^`~$*+=;:"()!?#%&/]/;

/**
 * Control characters, zero-width spaces, directional marks and bidi overrides: all
 * invisible on a wall, and the bidi ones can visually reorder neighbouring text.
 * Checked by code point rather than a regex literal so this file stays plain ASCII.
 */
function hasInvisible(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || c === 0x7f) return true; // C0 controls + DEL
    if (c >= 0x200b && c <= 0x200f) return true; // zero-width, LRM/RLM
    if (c >= 0x202a && c <= 0x202e) return true; // bidi embedding/override
    if (c >= 0x2066 && c <= 0x2069) return true; // bidi isolates
    if (c === 0x2060 || c === 0xfeff) return true; // word joiner, BOM
  }
  return false;
}

/**
 * A GitHub display name is whatever its owner typed, so it cannot be trusted on a
 * public wall. Fall back to the handle - which GitHub's own grammar keeps safe -
 * unless the name is plainly a name. Sanitizing at render rather than at sign time
 * is deliberate: nobody should be refused a signature over their display name.
 */
export function safeLabel(name: string | undefined, handle: string): string {
  if (!name) return handle;
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length < 2 || clean.length > 48) return handle;
  if (LABEL_URLISH.test(clean)) return handle;
  if (LABEL_TLD.test(clean)) return handle;
  if (LABEL_PROMO.test(clean)) return handle;
  if (LABEL_PUNCT.test(clean)) return handle;
  if (hasInvisible(clean)) return handle;
  return clean;
}

/**
 * Avatar straight from GitHub's CDN, keyed on the immutable numeric id when we have it.
 * Without an id, fall back to the handle: rename-fragile, but it shows the real avatar
 * rather than nothing, and a rebuild picks up any correction.
 */
export function avatarUrl(id: number | undefined, handle: string, size = 64): string {
  return id
    ? `https://avatars.githubusercontent.com/u/${id}?v=4&s=${size}`
    : `https://github.com/${encodeURIComponent(handle)}.png?size=${size}`;
}

export function profileUrl(handle: string): string {
  return `https://github.com/${handle}`;
}

export function formatCount(n: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** Initials for the avatar fallback when a GitHub account has been deleted. */
export function initials(label: string): string {
  const parts = label.split(/[\s\-_.]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : label.slice(0, 2);
  return letters.toUpperCase();
}

/** `querySelector` is `| null` under strict, and a missing node here is a bug, not a state. */
export function must<E extends Element>(root: ParentNode, selector: string): E {
  const el = root.querySelector<E>(selector);
  if (!el) throw new Error(`[SignManifesto] missing required node: ${selector}`);
  return el;
}
