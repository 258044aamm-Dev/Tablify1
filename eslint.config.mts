import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';

/**
 * The reference prototype and the prototype-era tooling are material for humans, not a module graph.
 * Nothing in the plugin may import from them — not even a type — or the frozen build starts leaking into
 * the shipped one.
 */
const referenceMaterial = {
	group: ['**/prototype/**', 'prototype/**', '**/tools/**'],
	message:
		'prototype/** and tools/** are outside the module graph. Copy what you need into src/ instead.',
};

const GRID_OBSIDIAN_MESSAGE =
	'The grid may import `obsidian` only in src/grid/menus/** or src/grid/dialogs/** (the two bridge modules). Anywhere else, reach the app through src/plugin/obsidian.ts.';

/**
 * Builds one `no-restricted-imports` setting: the caller's own restrictions plus the reference-material
 * ban, which applies to every layer. Composing them here is what keeps each file set to a single config
 * object — see the comment above the boundary blocks for why that matters.
 */
function restrict(options: {
	paths?: { name: string; message: string }[];
	patterns?: { group: string[]; message: string }[];
}) {
	return [
		'error',
		{
			paths: options.paths ?? [],
			patterns: [referenceMaterial, ...(options.patterns ?? [])],
		},
	];
}

export default defineConfig(
	// Reference material, build artefacts and caches are never linted.
	globalIgnores([
		'prototype/**',
		'main.js',
		'node_modules/**',
		'coverage/**',
		'playwright-report/**',
		'dist/**',
		// Prototype-era tooling (the reference prototype's own contrast gate). Superseded by
		// scripts/** gates; never part of the plugin build.
		'tools/**',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					// Plain-JS build entry points that are deliberately outside the TS program.
					allowDefaultProject: ['eslint.config.mts', 'esbuild.config.mjs'],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	// Build scripts run in Node, never in Obsidian, so the mobile-API guard does not apply to them.
	{
		files: ['scripts/**/*.ts', 'esbuild.config.mjs'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
	...obsidianmd.configs.recommended,
	// The house fence, enforced as errors. The upstream recommended set only warns on some of these,
	// and a warning is not a gate: `bun run lint` must fail, not print.
	{
		files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts', 'vitest.config.ts'],
		linterOptions: {
			noInlineConfig: true,
			reportUnusedDisableDirectives: 'error',
		},
		rules: {
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-non-null-assertion': 'error',
			'@typescript-eslint/ban-ts-comment': 'error',
			'@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
		},
	},
	// Product names are not sentence case. Without this the rule rewrites "Tablify" to "tablify" and
	// Obsidian's own feature name "Bases" to "bases" — a false positive, not a style violation.
	{
		files: ['src/**/*.ts'],
		rules: {
			'obsidianmd/ui/sentence-case': [
				'warn',
				{
					brands: ['Tablify', 'Bases'],
					acronyms: ['CSV', 'TSV', 'XLSX', 'URL'],
					enforceCamelCaseLower: true,
				},
			],
		},
	},
	// Build tooling runs in Node, never in Obsidian, so the mobile-API guard does not apply.
	{
		files: ['scripts/**/*.ts', 'esbuild.config.mjs'],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
	// The test suite is a development tool: it runs on a workstation, never inside Obsidian, so the
	// mobile-API rule does not apply to it any more than it applies to scripts/**. The sentence-case rule
	// is a check on product copy, and in a test it fires on ordinary data (`fm.title = 'y'` is reported as
	// a UI string). Both stay on for every shipped file.
	{
		files: ['tests/**/*.ts'],
		rules: {
			// Tests invoke prototype methods against synthetic receivers on purpose, so the
			// `this`-binding warning is noise there too.
			'@typescript-eslint/unbound-method': 'off',
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/ui/sentence-case': 'off',
		},
	},
	/*
	 * Architectural boundaries, enforced as lint errors (AGENTS.md §boundaries, docs/02 §Layers).
	 *
	 * One trap worth stating, because it bit this repository on 2026-10-05: `no-restricted-imports` is
	 * **not merged** across config objects. When two objects match the same file, the later one's option
	 * replaces the earlier one's wholesale, and a rule that only listed the prototype ban quietly erased
	 * the core's purity rule. So: exactly one block per file set, and every restriction that applies to
	 * that set is composed by `restrict()` below. `tests/unit/boundaries.test.ts` proves each one bites.
	 */
	{
		files: ['src/core/**/*.ts'],
		rules: {
			'no-restricted-imports': restrict({
				paths: [
					{
						name: 'obsidian',
						message: 'src/core must stay pure: it may not import the Obsidian API.',
					},
					{ name: 'react', message: 'src/core must stay pure: it may not import React.' },
					{
						name: 'react-dom',
						message: 'src/core must stay pure: it may not import React DOM.',
					},
				],
				patterns: [
					{
						group: ['obsidian/*', 'react/*', 'react-dom/*'],
						message:
							'src/core must stay pure: no Obsidian API and no React in the core.',
					},
				],
			}),
		},
	},
	// Adapters read and write data; they never render. React belongs to grid/ alone.
	{
		files: ['src/adapters/**/*.ts'],
		rules: {
			'no-restricted-imports': restrict({
				paths: [
					{ name: 'react', message: 'src/adapters must stay renderable-free: no React.' },
					{
						name: 'react-dom',
						message: 'src/adapters must stay renderable-free: no React DOM.',
					},
				],
				patterns: [
					{
						group: ['react/*', 'react-dom/*', 'react/jsx-runtime'],
						message:
							'src/adapters must stay renderable-free: no React in the data layer.',
					},
				],
			}),
		},
	},
	// The grid reaches Obsidian only through the two bridge modules (step 20). Everywhere else it is
	// ordinary React over the core, so it renders, tests and reasons without the app.
	{
		files: ['src/grid/**/*.ts', 'src/grid/**/*.tsx'],
		ignores: ['src/grid/menus/**', 'src/grid/dialogs/**'],
		rules: {
			'no-restricted-imports': restrict({
				paths: [{ name: 'obsidian', message: GRID_OBSIDIAN_MESSAGE }],
				patterns: [{ group: ['obsidian/*'], message: GRID_OBSIDIAN_MESSAGE }],
			}),
		},
	},
	{
		files: [
			'src/grid/menus/**/*.ts',
			'src/grid/menus/**/*.tsx',
			'src/grid/dialogs/**/*.ts',
			'src/grid/dialogs/**/*.tsx',
		],
		rules: {
			'no-restricted-imports': restrict({}),
		},
	},
	// A unit test that imports the React grid proves nothing about the grid (the DOM double is not a
	// browser) and drags React into the fast project. Grid behaviour is asserted in tests/dom.
	{
		files: ['tests/**/*.ts', 'tests/**/*.tsx'],
		ignores: ['tests/dom/**'],
		rules: {
			'no-restricted-imports': restrict({
				patterns: [
					{
						group: ['**/src/grid/**', 'src/grid/**'],
						message:
							'Only tests/dom may import src/grid (it needs a DOM and React). Unit-level tests stay on core/ and adapters/.',
					},
				],
			}),
		},
	},
	{
		files: ['tests/dom/**/*.ts', 'tests/dom/**/*.tsx'],
		rules: {
			'no-restricted-imports': restrict({}),
		},
	},
);
