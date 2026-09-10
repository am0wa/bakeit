import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import icon from "astro-icon";

const SITE = 'https://www.bakeit.dev';

// https://astro.build/config
export default defineConfig({
	vite: {
		plugins: [tailwindcss()],
	},
	integrations: [
		icon( {
			include: {
				mdi: ['puzzle'],
				twemoji: ['*'],
				['emojione-monotone']: ['*'] // Loads entire Icon set
			}
		}),
		starlight({
			favicon: '/bakeit-gradient-favicon.svg',
			// Starlight emits og:title/description/site_name and twitter:card itself, but never an
			// og:image. The URL must be absolute (scrapers do not resolve relative paths) and `site`
			// is deliberately unset, so the origin is spelled out here — same canonical host as the
			// OAuth callback in api/sign.ts. public/og-image.png is a 1200x630 render of
			// src/assets/bakeit-logo.svg — regenerate with `node scripts/og-image.mjs`.
			head: [
				{ tag: 'meta', attrs: { property: 'og:image', content: `${SITE}/og-image.png` } },
				{ tag: 'meta', attrs: { property: 'og:image:type', content: 'image/png' } },
				{ tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
				{ tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
				{ tag: 'meta', attrs: { property: 'og:image:alt', content: 'BakeIT — Modern Software Development Principles' } },
				{ tag: 'meta', attrs: { name: 'twitter:image', content: `${SITE}/og-image.png` } },
			],
			title: '🍰 BakeIT',
			logo: {
				src: './src/assets/bakeit-jam.svg',
				replacesTitle: true,
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/am0wa/bakeit' },
			],
			sidebar: [
				{
					label: '🥚 Get Started',
					items: [
						// Each item here is one entry in the navigation menu.
						{ label: 'Am0wA Manifesto', link: '/learn/am0wa-manifesto/' },
						{ label: 'Quick Start', link: '/learn/quick-start/' },
					],
				},
				{
					label: '🥞 Understand',
					items: [
						// Each item here is one entry in the navigation menu.
						{ label: 'Psychological biases', link: '/guides/psychology/' },
						{ label: 'Transformational leadership', link: '/guides/leadership/' },
						{ label: 'Problem solving', link: '/guides/problem-solving/' },
						{ label: 'Constructive feedback', link: '/guides/feedback/' },
						{ label: 'Engineering principles', link: '/guides/engineering/' },
						{ label: 'Design principles', link: '/guides/ux/' },
					],
				},
				{
					label: '🍕 Learn More',
					items: [{ autogenerate: { directory: 'learn-more' } }],
				},
			],
			components: {
				// Swap the dark/light/auto <select> for a plain dark/light toggle button.
				ThemeSelect: './src/components/ThemeSelect.astro',
			},
			customCss: ['./src/tailwind.css', './src/starlight.css'],
		}),
	],
});
