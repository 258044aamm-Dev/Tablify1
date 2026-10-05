/**
 * Release-shape gate. Fails the build when the shipped artefacts drift past the budgets in docs/02:
 * main.js <= 900 KB raw and <= 300 KB gzip, no `!important` in styles.css, and no reference to the
 * reference prototype inside the bundle.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const RAW_LIMIT = 900 * 1024;
const GZIP_LIMIT = 300 * 1024;

const out = (line: string): void => void process.stdout.write(`${line}\n`);
const err = (line: string): void => void process.stderr.write(`${line}\n`);
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(2)} KB`;

const failures: string[] = [];

if (!existsSync('main.js')) {
	err('bundle-size: main.js is missing — run `bun run build` first.');
	process.exit(1);
}

const bundle = readFileSync('main.js');
const raw = statSync('main.js').size;
const gzip = gzipSync(bundle).byteLength;

out(`main.js raw   ${raw} bytes (${kb(raw)})   limit ${kb(RAW_LIMIT)}`);
out(`main.js gzip  ${gzip} bytes (${kb(gzip)})  limit ${kb(GZIP_LIMIT)}`);

if (raw > RAW_LIMIT) {
	failures.push(`main.js is ${kb(raw)} raw, over the ${kb(RAW_LIMIT)} budget`);
}
if (gzip > GZIP_LIMIT) {
	failures.push(`main.js is ${kb(gzip)} gzipped, over the ${kb(GZIP_LIMIT)} budget`);
}

if (existsSync('styles.css')) {
	const css = readFileSync('styles.css', 'utf8');
	if (/!\s*important/.test(css)) {
		failures.push('styles.css contains !important — the design system forbids it');
	}
	out('styles.css    !important check: clean');
}

if (bundle.toString('utf8').includes('prototype/')) {
	failures.push('main.js references prototype/ — the reference prototype must never ship');
}

if (failures.length > 0) {
	err('\nbundle-size: FAILED');
	for (const line of failures) {
		err(`  - ${line}`);
	}
	process.exit(1);
}

out('\nbundle-size: OK');
