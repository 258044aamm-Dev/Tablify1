import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';

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
	// Build tooling runs in Node, never in Obsidian, so the mobile-API guard does not apply.
	{
		files: ['scripts/**/*.ts', 'esbuild.config.mjs'],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
	// Tests invoke prototype methods against synthetic receivers on purpose, so the
	// `this`-binding warning is noise there. The rule stays on for every shipped file.
	{
		files: ['tests/**/*.ts'],
		rules: {
			'@typescript-eslint/unbound-method': 'off',
		},
	},
	// The boundary rule the whole project rests on: the core is pure.
	{
		files: ['src/core/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: 'obsidian',
							message: 'src/core must stay pure: it may not import the Obsidian API.',
						},
						{
							name: 'react',
							message: 'src/core must stay pure: it may not import React.',
						},
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
				},
			],
		},
	},
);
