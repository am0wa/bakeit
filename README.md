# BakeIT HowTo

[![Built with Starlight](https://astro.badg.es/v2/built-with-starlight/tiny.svg)](https://starlight.astro.build)  
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/C0C6V10QN)

> 🧑‍🚀 **Seasoned astronaut?** Ignore this file. Have fun!

## 🚀 Project Structure

Inside this Astro + Starlight + Tailwind project, you'll see the following folders and files:

```
.
├── api/
│   └── sign.ts
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   ├── content/
│   │   └── docs/
│   ├── data/
│   │   └── signers/
│   ├── content.config.ts
│   ├── starlight.css
│   └── tailwind.css
├── astro.config.mjs
├── package.json
├── tsconfig.json
└── vercel.json
```

Starlight looks for `.md` or `.mdx` files in the `src/content/docs/` directory. Each file is exposed as a route based on its file name.

Images can be added to `src/assets/` and embedded in Markdown with a relative link.

Static assets, like favicons, can be placed in the `public/` directory.

Reusable `.astro` components live in `src/components/` and can be imported from any `.mdx` page.

Styles are split in two: `src/tailwind.css` holds the Tailwind theme (Tailwind v4 is configured in CSS, so there is no `tailwind.config.mjs`), and `src/starlight.css` overrides Starlight's own styles.

`src/data/signers/` holds the manifesto signatures — one JSON file per signer (see below). `api/sign.ts` is the single serverless function behind the signing form, and `vercel.json` keeps signature branches from spending build quota.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command           | Action                                            |
| :---------------- | :------------------------------------------------ |
| `npm install`     | Installs dependencies                             |
| `npm run dev`     | Starts local dev server at `localhost:4321`       |
| `npm run build`   | Type-checks and builds the production site to `./dist/` |
| `npm run preview` | Previews the build locally, before deploying      |

The dev server runs in the background — use `npx astro dev stop`, `npx astro dev status` or `npx astro dev logs` to manage it.

## 🖋️ Signing the manifesto

The [Am0wA Manifesto](https://bakeit.dev/learn/am0wa-manifesto/) has a signer wall. Each signature
is one file in `src/data/signers/<handle>.json`, so the wall is just git — and the filename is what
keeps it to one signature per person.

```json
{ "handle": "octocat", "at": "2026-09-09T00:00:00Z" }
```

Two ways to sign, both ending in a pull request:

1. **On the site** — click **Sign in with GitHub** on the manifesto page. GitHub confirms who U
   are, then the PR is opened for U. Nothing to type, and no one can sign on Ur behalf.
2. **Here on GitHub** — [add Ur signature file](https://github.com/am0wa/bakeit/new/main?filename=src%2Fdata%2Fsigners%2FYOUR-HANDLE.json&value=%7B%0A%20%20%22handle%22%3A%20%22YOUR-HANDLE%22%2C%0A%20%20%22at%22%3A%20%222026-09-09T00%3A00%3A00Z%22%0A%7D%0A). The path and contents come
   prefilled; swap in Ur handle and **name the branch `sign/<Ur-handle>`** when committing.

Signatures appear on the wall once the PR is merged and the site rebuilds. `id` and `name` are
optional — the avatar falls back to Ur GitHub profile picture without them.

`cryptoSig` is optional too, reserved for a future crypto-signing step: a detached SSH signature
over the fixed statement `I sign the Am0wA Manifesto`, checkable against Ur public keys at
`https://github.com/<handle>.keys`. Nothing verifies it yet, so it is not required and no
signature is shown as "verified".

```bash
printf 'I sign the Am0wA Manifesto' | ssh-keygen -Y sign -n manifesto -f ~/.ssh/id_ed25519
```

## 👀 Want to learn more?

Read [BakeIT](https://bakeit.dev/)
