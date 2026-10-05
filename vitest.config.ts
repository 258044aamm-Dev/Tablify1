import { defineConfig } from 'vitest/config';

// `obsidian` ships types only (`main` is an empty string): nothing can import it at runtime, so tests
// resolve it to a double. TypeScript keeps using the real obsidian.d.ts. Each project is its own Vite
// config, so the alias has to be declared per project as well as at the root.
const obsidianAlias = new URL('./tests/mocks/obsidian.ts', import.meta.url).pathname;
const resolve = { alias: { obsidian: obsidianAlias } };

export default defineConfig({
	resolve,
	test: {
		passWithNoTests: true,
		projects: [
			{
				resolve,
				test: {
					name: 'unit',
					environment: 'node',
					include: ['tests/unit/**/*.test.ts'],
				},
			},
			{
				resolve,
				test: {
					name: 'dom',
					environment: 'jsdom',
					include: ['tests/dom/**/*.test.ts'],
				},
			},
		],
		exclude: ['**/node_modules/**', 'prototype/**', 'dist/**', 'coverage/**'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			exclude: ['src/plugin/main.ts'],
			reporter: ['text', 'html'],
			thresholds: {
				// The core is the part that must not rot; the floor rises as the project grows.
				'src/core/**': { lines: 85, functions: 85, statements: 85, branches: 75 },
				lines: 60,
			},
		},
	},
});
