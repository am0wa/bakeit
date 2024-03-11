import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwind from '@astrojs/tailwind';
import icon from "astro-icon";

// https://astro.build/config
export default defineConfig({
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
			social: {
				github: 'https://github.com/am0wa/bakeit',
			},
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
						{ label: 'Constructive feedback', link: '/guides/feedback/' },
					],
				},
				{
					label: '🍕 Learn More',
					autogenerate: { directory: 'learn-more' },
				},
			],
			customCss: ['./src/tailwind.css', './src/starlight.css'],
		}),
		tailwind({ applyBaseStyles: true })
	],
});
