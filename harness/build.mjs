/**
 * The harness's own bundle. Two builds, one command:
 *
 *   1. `bun run build` (the plugin's own esbuild config) — the harness renders the **built** `styles.css`, so a
 *      style change is in the page by construction and there is no second CSS pipeline to keep in step.
 *   2. this file — `harness/mount.tsx` → `harness/build/harness.js`, with `obsidian` aliased to the browser-side
 *      runtime stub (`harness/obsidian-runtime.ts`), for the same reason `vitest.config.ts` aliases it in tests:
 *      the published `obsidian` package is types-only, so it has no runtime to import.
 *
 * Development React, deliberately: the harness is where a React warning is *useful*, and the bundle is served
 * from disk, never shipped.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import esbuild from 'esbuild';

const OUT = 'harness/build/harness.js';
mkdirSync(dirname(OUT), { recursive: true });

const context = await esbuild.context({
	entryPoints: ['harness/mount.tsx'],
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2020',
	jsx: 'automatic',
	// The page is served as a module from the repository root, so the bundle is one file with an inline map.
	sourcemap: 'inline',
	alias: { obsidian: resolve('harness/obsidian-runtime.ts') },
	define: { 'process.env.NODE_ENV': '"development"' },
	outfile: OUT,
	logLevel: 'info',
});

if (process.argv.includes('--watch')) {
	await context.watch();
	process.stdout.write(`harness: watching ${OUT}\n`);
} else {
	await context.rebuild();
	await context.dispose();
	process.stdout.write(`harness: built ${OUT}\n`);
}
