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
  The accent scale (violet) lives in an `@theme` block here. Starlight's own CSS sits in the `starlight` layer, so **anything you put in `base` loses to Starlight regardless of specificity**. Overrides that must beat Starlight go in `@layer components` (above `starlight`) — that is why the hero-button rule lives there. The gray scale is deliberately *not* overridden: `@astrojs/starlight-tailwind` already maps `--color-gray-*` to zinc.
- **`src/starlight.css`** — unlayered, so it beats every layer. Used for targeted Starlight internals (markdown blockquotes, the `:focus-visible` ring).

Tailwind Preflight is **not** imported, by design — `@astrojs/starlight-tailwind` restores only the reset rules Starlight needs. If stray margins appear, `@import 'tailwindcss/preflight.css' layer(base);` is the escape hatch.

Starlight ships no `:focus-visible` styles at all, so `src/starlight.css` supplies the accent focus ring; without it browsers fall back to their own (blue in Chrome).

### Components and icons

`src/components/` holds a small set of hand-rolled components used from `.mdx`. `Card.astro` renders the visual card; `ClickableCard.astro` wraps it in a `<clickable-card>` custom element for click-to-navigate.

Icons go through `astro-icon` with a project-specific convention in `src/components/emojiName.ts`: components take a bare name (`icon="duck"`) and `getEmoji()` prefixes it with `twemoji:` or, when `monochrome` is set, `emojione-monotone:`. Both sets are loaded wholesale in `astro.config.mjs` (`['*']`), so any emoji name from those sets works without config changes.

**`ClickableCard.astro`'s script must stay `is:inline` and nested inside `<clickable-card>`.** Astro renders bundled scripts in declaration order and hoists them to a sibling position — which makes the script a direct child of a wrapping `<CardGrid>` and shifts Starlight's `:nth-child(2n)` stagger onto the wrong cards. The inline script is guarded with `customElements.get()` because it is emitted once per card instance.

## Constraints and known noise

- **`typescript` is held at `^6`** — `@astrojs/check@0.9.10` peers `^5 || ^6`, so TS 7 breaks the peer. Re-check when a newer `@astrojs/check` ships.
- **`@astrojs/markdown-remark` is intentionally not installed.** Astro 7 defaults to the Sätteri Markdown processor and Starlight bundles `@astrojs/markdown-satteri`. Only add it if the project starts using custom remark/rehype plugins.
- Three build warnings are expected and benign: the `i18n` collection notice (inherent to a monolingual Starlight site — declaring the collection adds a *second* warning, so leave it), `astro-icon`'s missing `src/icons` dir, and `@astrojs/sitemap` skipping because `site` is not set in `astro.config.mjs`. Set `site` if a sitemap is ever wanted.
