/**
 * Release-asset gate.
 *
 * Obsidian's automated review reads `manifest.json` at the tag you publish and expects `main.js`,
 * `manifest.json` and `styles.css` as three separate release assets. This script assembles exactly
 * that directory and refuses to do it when the release would be wrong:
 *
 *   - a dirty working tree means the assets do not correspond to any commit (unless --allow-dirty),
 *   - the tag must equal `manifest.json`'s version exactly, with no `v` prefix — the tag is the version,
 *   - `dist/<version>/` must end up holding exactly three files, no more and no fewer.
 *
 * Run: bun scripts/release-assets.ts --tag 0.1.0 [--allow-dirty]     (or set TAG=0.1.0)
 * No network access, ever.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const write = (line: string): void => void process.stdout.write(`${line}\n`);
const fail = (line: string): void => void process.stderr.write(`${line}\n`);

const ASSETS = ['main.js', 'manifest.json', 'styles.css'] as const;

type Options = { tag: string | undefined; allowDirty: boolean };

function parseArgs(argv: string[]): Options {
	let tag = process.env['TAG'];
	let allowDirty = false;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i] ?? '';
		if (arg === '--allow-dirty') {
			allowDirty = true;
			continue;
		}
		if (arg.startsWith('--tag=')) {
			tag = arg.slice('--tag='.length);
			continue;
		}
		if (arg === '--tag') {
			tag = argv[i + 1];
			i += 1;
		}
	}
	return { tag, allowDirty };
}

function manifestVersion(): string {
	const raw = readFileSync('manifest.json', 'utf8');
	const parsed: unknown = JSON.parse(raw);
	if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
		throw new Error('manifest.json has no version field');
	}
	const version = parsed.version;
	if (typeof version !== 'string') {
		throw new Error('manifest.json version is not a string');
	}
	return version;
}

function isTreeDirty(): boolean {
	const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
	return status.trim().length > 0;
}

const { tag, allowDirty } = parseArgs(process.argv.slice(2));

if (tag === undefined || tag.length === 0) {
	fail('release-assets: no tag. Pass --tag <version> or set TAG=<version>.');
	process.exit(1);
}

if (tag.startsWith('v')) {
	fail(
		`release-assets: the tag must not have a "v" prefix (got "${tag}"). Obsidian matches the tag to the version exactly.`,
	);
	process.exit(1);
}

const version = manifestVersion();
write(`release-assets: manifest.json declares version ${version}`);

if (tag !== version) {
	fail(`release-assets: tag "${tag}" does not equal manifest version "${version}".`);
	process.exit(1);
}

let dirty = false;
try {
	dirty = isTreeDirty();
} catch {
	fail('release-assets: could not read `git status` — is this a git working tree?');
	process.exit(1);
}

if (dirty) {
	if (!allowDirty) {
		fail(
			'release-assets: the working tree is dirty. Commit first, or pass --allow-dirty for a local dry run.',
		);
		process.exit(1);
	}
	write(
		'release-assets: working tree is dirty — allowed by --allow-dirty (assets will not match a commit)',
	);
}

const missing = ASSETS.filter((asset) => !existsSync(asset));
if (missing.length > 0) {
	fail(`release-assets: missing ${missing.join(', ')} — run \`bun run build\` first.`);
	process.exit(1);
}

const target = join('dist', version);
mkdirSync(target, { recursive: true });

for (const asset of ASSETS) {
	copyFileSync(asset, join(target, asset));
	write(`  ${asset.padEnd(14)} ${String(statSync(asset).size).padStart(7)} bytes`);
}

const produced = readdirSync(target).sort();
if (produced.length !== ASSETS.length) {
	fail(
		`release-assets: dist/${version}/ holds ${produced.length} files, expected exactly ${ASSETS.length}: ${produced.join(', ')}`,
	);
	process.exit(1);
}

const unexpected = produced.filter((name) => !ASSETS.some((asset) => asset === name));
if (unexpected.length > 0) {
	fail(`release-assets: unexpected file(s) in dist/${version}/: ${unexpected.join(', ')}`);
	process.exit(1);
}

write(
	`release-assets: dist/${version}/ contains exactly ${produced.length} files: ${produced.join(', ')}`,
);
write('release-assets: OK — attach these three to the release; do not zip them.');
