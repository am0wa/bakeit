import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import icon from "astro-icon";

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
			customCss: ['./src/tailwind.css', './src/starlight.css'],
		}),
	],
});
