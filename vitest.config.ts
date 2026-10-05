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
			// Product code only. The prototype is frozen reference material, the harness is a browser
			// driver, the tests are not shipped, and `src/plugin/main.ts` is lifecycle glue that only a
			// real Obsidian can run — measuring any of them would move the number without informing it.
			include: ['src/**/*.ts'],
			exclude: ['src/plugin/main.ts', 'prototype/**', 'harness/**', 'tests/**'],
			reporter: ['text', 'html'],
			thresholds: {
				/*
				 * The core is the part that must not rot, so it carries the highest floor: 85% lines and
				 * 75% branches from the moment it has content (step 09). While `src/core/**` matches no
				 * file, a glob threshold is satisfied by having nothing to check — verified by running
				 * `bunx vitest run --coverage` on an empty `src/core/`, which reports no `core` rows and
				 * exits 0. It is not a hole: the first file committed under `src/core/` is measured
				 * immediately, because the threshold is a ratio over whatever the glob matches.
				 */
				'src/core/**': { lines: 85, functions: 85, statements: 85, branches: 75 },
				lines: 60,
			},
		},
	},
});
