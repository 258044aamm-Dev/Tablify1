/**
 * The spike's own build: one file in, one `main.js` out, `obsidian` left external because Obsidian provides
 * it. Deliberately separate from `esbuild.config.mjs` so nothing about the spike can reach the shipped
 * bundle — see `README.md` for why this is the option that was chosen.
 */
import { build } from 'esbuild';

await build({
	entryPoints: ['main.ts'],
	outfile: 'main.js',
	bundle: true,
	external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
	format: 'cjs',
	target: 'es2018',
	platform: 'browser',
	sourcemap: false,
	logLevel: 'info',
});
