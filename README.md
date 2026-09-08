# BakeIT HowTo

[![Built with Starlight](https://astro.badg.es/v2/built-with-starlight/tiny.svg)](https://starlight.astro.build)  
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/C0C6V10QN)

> 🧑‍🚀 **Seasoned astronaut?** Ignore this file. Have fun!

## 🚀 Project Structure

Inside this Astro + Starlight + Tailwind project, you'll see the following folders and files:

```
.
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   ├── content/
│   │   └── docs/
│   ├── content.config.ts
│   ├── starlight.css
│   └── tailwind.css
├── astro.config.mjs
├── package.json
└── tsconfig.json
```

Starlight looks for `.md` or `.mdx` files in the `src/content/docs/` directory. Each file is exposed as a route based on its file name.

Images can be added to `src/assets/` and embedded in Markdown with a relative link.

Static assets, like favicons, can be placed in the `public/` directory.

Reusable `.astro` components live in `src/components/` and can be imported from any `.mdx` page.

Styles are split in two: `src/tailwind.css` holds the Tailwind theme (Tailwind v4 is configured in CSS, so there is no `tailwind.config.mjs`), and `src/starlight.css` overrides Starlight's own styles.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command           | Action                                            |
| :---------------- | :------------------------------------------------ |
| `npm install`     | Installs dependencies                             |
| `npm run dev`     | Starts local dev server at `localhost:4321`       |
| `npm run build`   | Type-checks and builds the production site to `./dist/` |
| `npm run preview` | Previews the build locally, before deploying      |

The dev server runs in the background — use `npx astro dev stop`, `npx astro dev status` or `npx astro dev logs` to manage it.

## 👀 Want to learn more?

Read [BakeIT](https://bakeit.dev/)
