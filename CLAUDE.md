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
  confirms the GitHub account exists, checks the file does not already exist, then commits.
  `api/ping.ts` exists only to prove root-level `api/` is picked up; delete it once confirmed.
- `GITHUB_TOKEN` is a fine-grained PAT (this repo only, `Contents: write`), set in Vercel's env
  for Production **and** Preview. **Never give it a `PUBLIC_` prefix** — that would inline the
  token into the client bundle. `SIGN_MODE=pr` opens a PR per signature instead of committing.
- **Moderation is `git revert`.** Impersonation is possible by design (anyone can type any
  handle); the account must exist and can sign only once, and every signature is a visible commit.
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
