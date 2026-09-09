# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`bakeit` is a static documentation site (published at https://bakeit.dev/) built on Astro + Starlight + Tailwind. All content lives in `src/content/docs/` as `.md`/`.mdx`; there is no backend, no database, and no test suite.

## Commands

```bash
npm run dev        # dev server on :4321
npm run build      # astro check && astro build  -> dist/
npm run preview    # serve the built dist/
npx astro check    # typecheck only (.astro/.ts/.mdx)
npx astro sync     # regenerate .astro/types.d.ts after content-config changes
```

There are no tests and no linter — `astro check` is the only static gate, and `npm run build` runs it. A green build means 0 errors/0 warnings/0 hints plus 12 emitted pages.

**`astro dev` daemonizes** (Astro 7 behaviour): it detaches instead of holding the terminal. Manage it with `npx astro dev stop`, `npx astro dev status`, `npx astro dev logs`. Starting a second one without stopping the first will leave an orphan on the port.

## Architecture

### Content pipeline

`src/content.config.ts` declares a single `docs` collection using Starlight's `docsLoader()` (Astro Content Layer API). Pages are file-routed from `src/content/docs/`. Do **not** move this file back to `src/content/config.ts` — that legacy location was removed in Astro 6.

The sidebar in `astro.config.mjs` is mostly **hand-maintained**: the "Get Started" and "Understand" groups list every page explicitly, so adding a doc under `learn/` or `guides/` also requires a sidebar entry there. Only the "Learn More" group autogenerates from `learn-more/`. Note autogenerate must be wrapped in `items: [{ autogenerate: ... }]` (Starlight 0.39+ syntax).

### Styling — cascade layers matter more than specificity

Tailwind v4 is wired in as a **Vite plugin** (`@tailwindcss/vite` in `astro.config.mjs`), not an Astro integration. `@astrojs/tailwind` is intentionally absent: it caps at Astro 5 and Tailwind 3. There is no `tailwind.config.mjs` — theme config is CSS-first.

Two stylesheets are loaded via Starlight's `customCss`, with distinct jobs:

- **`src/tailwind.css`** — declares the layer order and imports Tailwind:
  ```css
  @layer base, starlight, theme, components, utilities;
  ```
  The accent scale (violet) lives in an `@theme` block here. Starlight's own CSS sits in the `starlight` layer, so **anything you put in `base` loses to Starlight regardless of specificity**. Overrides that must beat Starlight go in `@layer components` (above `starlight`) — that is why the hero-button rule lives there. **This applies to global stylesheets only.** A scoped `<style>` inside a `.astro` component is emitted *unlayered* and after `customCss`, so it already beats every `@layer starlight.*` rule regardless of specificity — component CSS needs no `@layer components`. Verified in `dist/`: our rules land in a page stylesheet with zero `@layer`, while Starlight's own arrive as `@layer starlight.components{…}`. The gray scale is deliberately *not* overridden: `@astrojs/starlight-tailwind` already maps `--color-gray-*` to zinc.
- **`src/starlight.css`** — unlayered, so it beats every layer. Used for targeted Starlight internals (markdown blockquotes, the `:focus-visible` ring).

Tailwind Preflight is **not** imported, by design — `@astrojs/starlight-tailwind` restores only the reset rules Starlight needs. If stray margins appear, `@import 'tailwindcss/preflight.css' layer(base);` is the escape hatch.

Starlight ships no `:focus-visible` styles at all, so `src/starlight.css` supplies the accent focus ring; without it browsers fall back to their own (blue in Chrome).

### Components and icons

`src/components/` holds a small set of hand-rolled components used from `.mdx`. `Card.astro` renders the visual card; `ClickableCard.astro` wraps it in a `<clickable-card>` custom element for click-to-navigate.

Icons go through `astro-icon` with a project-specific convention in `src/components/emojiName.ts`: components take a bare name (`icon="duck"`) and `getEmoji()` prefixes it with `twemoji:` or, when `monochrome` is set, `emojione-monotone:`. Both sets are loaded wholesale in `astro.config.mjs` (`['*']`), so any emoji name from those sets works without config changes.

**`ClickableCard.astro`'s script must stay `is:inline` and nested inside `<clickable-card>`.** Astro renders bundled scripts in declaration order and hoists them to a sibling position — which makes the script a direct child of a wrapping `<CardGrid>` and shifts Starlight's `:nth-child(2n)` stagger onto the wrong cards. The inline script is guarded with `customElements.get()` because it is emitted once per card instance.

### Signer wall ("Sign the manifesto")

Signatures are **files, not database rows**: one JSON file per signer at
`src/data/signers/<handle>.json`. The filename (lowercased handle) *is* the uniqueness
constraint, so there is no dedupe logic anywhere. `SignManifesto.astro` reads them with
`import.meta.glob({ eager: true })`, so **the wall is built at deploy time** — adding a signer
is a commit, and the wall only changes on rebuild (Vercel auto-builds on push to `main`).

- `api/sign.ts` is a **Vercel function** at the repo root (not an Astro route — no adapter is
  installed, and `@astrojs/vercel` would change the whole build output). It validates the handle,
  confirms the GitHub account exists, checks the file does not already exist, then writes it.
  `api/ping.ts` exists only to prove root-level `api/` is picked up; delete it once confirmed.
- **Both functions must use a NAMED METHOD EXPORT** (`export async function POST`), never
  `export default`. Vercel's Node runtime only takes the Web-handler path for a module exporting
  `fetch` or a named HTTP method; a bare default export is treated as a legacy `(req, res)`
  handler, so it receives an `IncomingMessage`, the returned `Response` is discarded, and the
  request hangs to a **504 instead of failing loudly**. The named form also gives 405s for free.
- **`SIGN_MODE` defaults to `pr`**: each signature arrives as a pull request on a `sign/<handle>`
  branch, so nothing reaches `main` — and no production rebuild happens — without an explicit
  merge. Set `SIGN_MODE=commit` to write straight to `main` (instant, unmoderated).
- `GITHUB_TOKEN` is a fine-grained PAT (this repo only) set in Vercel's env. It needs
  **Contents: Read and write** and — because PR mode is the default — **Pull requests: Read and
  write**. (Metadata: Read-only is automatic; `GET /users/{handle}` needs no permission.)
  **Never give it a `PUBLIC_` prefix** — that would inline the token into the client bundle.
- **`vercel.json` is load-bearing, not boilerplate.** `git.deploymentEnabled: {"sign/*": false}`
  stops signature branches from creating preview deployments. Without it PR mode costs **two**
  deployments per signature (preview on push, production on merge) versus one for commit mode —
  worse, not better, against Hobby's 100 deployments/day. An **Ignored Build Step is not a
  substitute**: a cancelled build still counts toward the quota. Config is read from `main`.
- **Both result panels are server-driven.** The success and "already" panels render the `message`
  the function returns, because only the server knows whether it committed (live after the next
  build) or queued a PR (live after a merge). Do not hardcode either promise in the markup.
  In PR mode the function also returns the count **unchanged** — the signature is not on the wall
  until merge, so bumping it would show a number the next page load contradicts.
- **Moderation is the merge** in PR mode (`git revert` in commit mode). Impersonation is possible
  by design — anyone can type any handle, and the commit is authored by the PAT's identity, not
  the signer's — so review the PR rather than trusting the handle.
- GitHub's **"Automatically delete head branches"** is enabled, or `sign/*` branches would
  accumulate. Hobby also allows only **1 concurrent build**, so simultaneous merges queue.
- **The cap is mode-dependent, and that matters.** `overCapacity()` counts commits on the base
  branch in `commit` mode but **open `sign/*` PRs** in PR mode. Counting commits in PR mode
  measured *nothing* — signatures never touch the base branch until merged — which left the
  endpoint effectively unlimited. It matches on the branch prefix our code sets, not the PR title
  (renameable). `MAX_PENDING_PRS` must stay **under 100**, or the single `per_page=100` page stops
  being sufficient and real pagination is needed. Both checks **fail open**: a GitHub outage must
  not block signing, and a missed cap only costs noise.
- **Capacity is checked before `GET /users`, deliberately.** Each request spends calls from a
  shared **5,000/hr** token budget, so ~1,250 req/hr exhausts it and breaks signing for everyone —
  a real DoS vector. Checking capacity first makes a flood cost one call per request instead of
  four. Shape validation runs before any network call, so bad handles cost zero. **Do not reorder
  these for readability.**
- **The `Origin` check is not a control.** A script can omit or forge the header, and an absent
  header is allowed on purpose (curl, privacy tooling). It only turns away casual cross-site
  embedding. Do not build on it.
- **Kill switch: revoke the PAT on GitHub.** Immediate, server-side, no redeploy — every call
  fails, the function returns its generic 502, and the site is unaffected because the wall is
  static. Deleting `GITHUB_TOKEN` in Vercel is *not* equivalent: env vars bind at deploy time, so
  it needs a redeploy to take effect.
- **CAPTCHA is deliberately absent.** Turnstile is the escalation if abuse appears: invisible mode,
  verify with one `POST` to `challenges.cloudflare.com/turnstile/v0/siteverify`, secret in
  `TURNSTILE_SECRET_KEY` (no `PUBLIC_` prefix), placed **before** any GitHub call so rejected bots
  cost no quota. It **must fail closed** — accept a missing token and a bot simply omits it — which
  is the real cost: it makes Cloudflare a runtime dependency of signing. Keep the queue cap too;
  Turnstile bounds requests, the cap bounds the backlog.
- **Signing is GitHub OAuth, and the handle comes ONLY from `GET /user`.** Never from a query
  parameter or a body. The original `POST /api/sign` took a typed handle, so anyone could sign as
  anyone — proven by signing as `@octocat`. That export was **deleted**, not guarded: the
  impersonable path no longer exists. Do not reintroduce a caller-supplied handle.
- **Two credentials, two jobs.** The OAuth *user* token establishes **identity** (never stored,
  logged, or returned); `GITHUB_TOKEN` supplies **authority**, because a visitor's own token has no
  write access to this repo. Env: `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`.
- **The `state` parameter is mandatory, not garnish.** Without it an attacker can craft a link that
  signs the manifesto as whoever clicks it — the exact harm OAuth removes. It is stateless:
  `<nonce>.<issuedAt>.<hmac>` keyed on the client secret, verified with `timingSafeEqual` plus a
  10-minute freshness window. No cookie, no store. A malformed/wrongly-signed state answers **400**
  (cannot be a real visitor); a correctly-signed but stale one redirects with `?sign=expired`, since
  that *is* a real visitor who left the authorize screen open.
- **No OAuth scope is requested** — `GET /user` returns the public profile without one, and
  deliberately no email scope. If GitHub ever requires one, use `read:user` and nothing more.
- **OAuth Apps allow exactly one callback URL**, matched exactly: `https://www.bakeit.dev/api/sign`.
  Local development of this flow therefore needs its own OAuth App. `redirect_uri` must be sent in
  both the authorize and token-exchange steps.
- **The client has no fetch.** The sign-in control is a plain `<a href="/api/sign">`, so the flow
  works with JS disabled; the function redirects back with `?sign=queued|signed|already|busy|expired|error`
  and the script only turns that into a panel and strips the param so a refresh cannot replay it.
- **`Signer.cryptoSig` is a reservation, not a feature.** Optional string for a future detached
  SSH signature over the fixed statement `I sign the Am0wA Manifesto`, checkable via
  `ssh-keygen -Y verify` against `https://github.com/<handle>.keys` (public, unauthenticated).
  Nothing validates it today, so **render no "verified" badge** from its presence — absence means
  unsigned, presence means *unverified*. `/api/sign` can never populate it (no access to the
  signer's private key), so only the GitHub path or a CLI can. Deliberately **no** version field:
  the signature attests who signed, not which revision of the principles. Any verifier must stay
  **out** of `npm run build` — build-time network calls would let a GitHub outage break deploys.
- **`Signer.id` and `.at` are optional** so the one-click GitHub path works: a human cannot know
  their numeric id. `avatarUrl()` falls back to `github.com/<handle>.png`, and the wall's sort
  tolerates a missing `at` — without that, one hand-written file would **fail the whole site
  build**, not just render oddly.
- **Branch protection:** *Require a pull request before merging* on `main` (admin bypass left on)
  is worth having — it makes the PAT structurally unable to write to `main` even if `SIGN_MODE`
  is flipped to `commit`. But do **not** add any of these, each of which deadlocks signing:
  *require status checks* (no Vercel check ever reports on `sign/*`, since `vercel.json` disables
  those deployments, so the PR can never be merged), *require approvals* (signature PRs are
  opened by your own PAT and GitHub forbids self-approval), or protection on `sign/*` itself
  (rules can prevent the automatic head-branch deletion).
- The component owns its anchor via `id={anchor}` on the root element, and there is deliberately
  **no markdown heading** above it: the signing form is the manifesto's closing call to action, not
  a topic, so a `##` there would put an action item in the "On this page" ToC. The wall's own `<h3>`
  nests under "Manifesto for Modern Software Development" and, because Starlight builds the ToC from
  the markdown AST, headings inside imported `.astro` components never appear in it.
  If a heading is ever reinstated, do **not** anchor to its generated slug -- a trailing emoji
  leaves a variation selector, so the slug ends in a stray dash, and MDX cannot override it
  (`{#custom-id}` is parsed as a JSX expression and fails the build).
- Handle grammar is deliberately duplicated in `api/sign.ts` rather than imported from
  `src/components/signManifesto.ts`: the function's copy is authoritative (the client's is only
  for fast feedback) and it keeps the function bundle free of cross-directory imports.
- GitHub **display names are user-controlled**, so always render them through `safeLabel()`,
  which falls back to the handle. Avatars are keyed on the immutable numeric `id`, never the
  handle, and carry `referrerpolicy="no-referrer"` — hotlinking otherwise leaks every visitor's
  IP and referring URL to GitHub, on the page that links to gdpr.eu.
- Avatar **build-time caching is deliberately not used**: Astro downloads remote images during
  `astro build`, so an unreachable GitHub would fail the build.

Two traps this component had to work around, both worth knowing before writing any form here:

- `@astrojs/starlight-tailwind` puts `*{border:0 solid}` in `@layer base` and Preflight is not
  imported, so **inputs and buttons have no border but keep UA `appearance`/`background`** — a
  white box in dark mode. Every `appearance`/`border`/`background-color` declaration on an input
  is load-bearing.
- `is:inline` scripts are **not** processed by Vite, so `import.meta.env.PUBLIC_*` is not
  substituted inside them. `SignManifesto.astro` uses a **bundled** `<script>` instead; the
  `is:inline` requirement documented above is specific to `ClickableCard` inside a `CardGrid`.

## Constraints and known noise

- **`typescript` is held at `^6`** — `@astrojs/check@0.9.10` peers `^5 || ^6`, so TS 7 breaks the peer. Re-check when a newer `@astrojs/check` ships.
- **`@astrojs/markdown-remark` is intentionally not installed.** Astro 7 defaults to the Sätteri Markdown processor and Starlight bundles `@astrojs/markdown-satteri`. Only add it if the project starts using custom remark/rehype plugins.
- Three build warnings are expected and benign: the `i18n` collection notice (inherent to a monolingual Starlight site — declaring the collection adds a *second* warning, so leave it), `astro-icon`'s missing `src/icons` dir, and `@astrojs/sitemap` skipping because `site` is not set in `astro.config.mjs`. Set `site` if a sitemap is ever wanted.
