/**
 * Brand gate — fails when a third-party brand name reaches text that ships or that the public reads.
 *
 * Every occurrence of a brand token in the repository is either:
 *   - in a file that ships nothing and is read only by the author (`INTERNAL_FILES`), or
 *   - on a line covered by an explicit, named permission in `ALLOWED_LINES`.
 * Anything else fails the gate, and the gate prints every permission it grants so the permissions
 * themselves can be audited rather than trusted.
 *
 * The gate reads the working tree only: no network, no configuration, no environment.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const write = (line: string): void => void process.stdout.write(`${line}\n`);
const fail = (line: string): void => void process.stderr.write(`${line}\n`);

/** The brand tokens under guard. Word boundaries keep `airtable-tabula` (a repo name) matchable. */
const TOKEN_PATTERN = /\b(anthropic|claude|airtable)\b/gi;

/** Never scanned: reference material, internal specs, caches and build artefacts. */
const SKIP_DIRS = new Set([
	'.git',
	'node_modules',
	'prototype',
	'docs',
	'coverage',
	'dist',
	'playwright-report',
	'.bun',
]);
const SKIP_FILES = new Set([
	'bun.lock',
	'package-lock.json',
	'main.js',
	'main.js.map',
	'.DS_Store',
]);

/** Only text is scanned, so binary artefacts can never produce a false page of noise. */
const TEXT_EXT = new Set([
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.mjs',
	'.mts',
	'.cjs',
	'.json',
	'.md',
	'.txt',
	'.css',
	'.html',
	'.yml',
	'.yaml',
	'.toml',
	'.sh',
	'.svg',
]);
const TEXT_NAMES = new Set([
	'LICENSE',
	'NOTICE',
	'.editorconfig',
	'.gitignore',
	'.prettierrc',
	'.prettierignore',
]);

/**
 * Whole files that are internal engineering documents: never published, never shown to users, and
 * required to quote the rules they enforce. Each permission is printed with its match count.
 */
const INTERNAL_FILES: { path: string; reason: string }[] = [
	{ path: 'prompts/', reason: 'internal build prompts: quote the brand rules verbatim' },
	{ path: 'AGENTS.md', reason: 'internal rules for the coding agent: list the banned brands' },
	{ path: 'START-HERE.md', reason: 'internal onboarding briefs' },
	{ path: 'PROGRESS.md', reason: 'internal step log' },
	{ path: 'DESIGN-REVIEW.md', reason: 'internal design record' },
	{ path: 'PLAN-ui-ux-pass.md', reason: 'internal design plan' },
	{ path: 'PLAN-style-audit-notes', reason: 'internal style queue' },
	{ path: 'PROCEED-ASSUMPTION-2026-10-05.md', reason: 'internal assumption record' },
	{ path: 'scripts/brand-gate.ts', reason: 'this file defines the rules' },
	{ path: 'scripts/manifest-check.ts', reason: 'the manifest validator defines the same tokens' },
];

/**
 * Named permissions for text that ships. The pattern is matched against a three-line window centred
 * on the match, because prose wraps: a permission still names one exact file and one exact sentence
 * fragment, but a wrapped sentence stays covered.
 */
const ALLOWED_LINES: { path: string; pattern: RegExp; reason: string }[] = [
	{
		path: 'README.md',
		pattern: /successor to/,
		reason: 'upstream attribution: the MIT licence requires it',
	},
	{
		path: 'NOTICE',
		pattern: /carries attribution to, the upstream project/,
		reason: 'attribution statement, declared rather than implied',
	},
	{
		path: 'NOTICE',
		pattern: /not affiliated with, endorsed by, or sponsored by/,
		reason: 'non-affiliation statement',
	},
	{
		path: 'NOTICE',
		pattern: /the only host it contacts is/,
		reason: 'network-use disclosure: names the API host the sync will contact',
	},
	{
		path: 'src/sync/',
		pattern: /api\.airtable\.com/,
		reason: 'the API host the sync client must call',
	},
	{
		path: 'src/sync/',
		pattern:
			/(Connect to|Linked to|token for) [Aa]n? ?[Aa]irtable|Airtable (token|base|connection)/,
		reason: 'user-facing copy that names the service the sync connects to',
	},
	{
		path: 'src/plugin/settings/secrets.ts',
		pattern: /Airtable (token|base|connection)/,
		reason: 'the same user-facing copy, in the file that stores the token',
	},
	/*
	 * The provider integration (steps 25–26), as six file-scoped permissions.
	 *
	 * What this gate enforces is that Tablify never *borrows* a brand: no marks, no logos, no typefaces, nothing
	 * implying that somebody else makes this. It is not a rule that the plugin may not name the one service a person
	 * explicitly connects it to — a URL has to point somewhere, a stored secret key has a fixed id, and the settings
	 * copy has to say what the token is for. So the integration's own files carry a permission each, and every other
	 * file still fails on a single match, which is the property worth keeping. Each is printed with its match count.
	 */
	{
		path: 'src/sync/airtable/',
		pattern: /./,
		reason: 'the provider client: its URLs, error bodies and doc lines name the service it calls',
	},
	{
		path: 'src/sync/LinkStore.ts',
		pattern: /./,
		reason: 'the link file: the key `airtable` and its sentences are the shape docs/03 §Sync state fixes',
	},
	{
		path: 'src/plugin/settings/secrets.ts',
		pattern: /./,
		reason: 'the token flow: the secret id is `tablify-airtable-token`, already stored by any install',
	},
	{
		path: 'tests/unit/airtable-client.test.ts',
		pattern: /./,
		reason: "the client test: every assertion is about the service's URLs, bodies and statuses",
	},
	{
		path: 'tests/unit/secrets.test.ts',
		pattern: /./,
		reason: 'the token test: the secret id and the sentences it asserts name the service',
	},
	{
		path: 'tests/unit/sync-core.test.ts',
		pattern: /./,
		reason: 'the port, link and hash tests: their fixtures and sentences name the service',
	},
	{
		path: 'src/plugin/sync/',
		pattern: /Airtable token|document\.airtable|sync\/airtable\//,
		reason: 'the sync surface: the token field and the two sentences that point at it, the link document`s `airtable` key (docs/03 §Sync state fixes it), and the provider client`s module path, which only the composition root imports',
	},
	{
		path: 'tests/dom/conflict-review.test.tsx',
		pattern: /Add an Airtable token|airtable: \{/,
		reason: "asserts the panel's own user-facing sentence, and builds a link document with the `airtable` key docs/03 fixes",
	},
	{
		path: 'tests/unit/pull-push.test.ts',
		pattern: /sync\/airtable\/client/,
		reason: 'imports the client under test by its module path',
	},
	{
		path: 'tests/unit/startup.test.ts',
		pattern: /api\.airtable\.com/,
		reason: 'the startup proof`s marker: the request host exists only in the provider client, so finding it in the bundle is the inlining measurement',
	},
];

type Match = { file: string; line: number; text: string };

function isTextFile(name: string): boolean {
	const dot = name.lastIndexOf('.');
	if (dot <= 0) {
		return TEXT_NAMES.has(name);
	}
	return TEXT_EXT.has(name.slice(dot)) || TEXT_NAMES.has(name);
}

function collectFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const absolute = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) {
				continue;
			}
			found.push(...collectFiles(absolute));
			continue;
		}
		if (SKIP_FILES.has(entry.name) || !isTextFile(entry.name)) {
			continue;
		}
		found.push(absolute);
	}
	return found;
}

const toRepoPath = (absolute: string): string => relative(ROOT, absolute).split(sep).join('/');

const internalReason = (repoPath: string): string | undefined =>
	INTERNAL_FILES.find((entry) => repoPath.startsWith(entry.path) || repoPath === entry.path)
		?.reason;

function allowanceFor(repoPath: string, lines: string[], index: number): string | undefined {
	const window = [lines[index - 1] ?? '', lines[index] ?? '', lines[index + 1] ?? ''].join(' ');
	for (const entry of ALLOWED_LINES) {
		if (!(repoPath === entry.path || repoPath.startsWith(entry.path))) {
			continue;
		}
		if (entry.pattern.test(window)) {
			return entry.reason;
		}
	}
	return undefined;
}

const violations: Match[] = [];
let allowedMatches = 0;
const allowedFiles = new Map<string, { count: number; reason: string }>();

for (const absolute of collectFiles(ROOT)) {
	const repoPath = toRepoPath(absolute);
	const text = readFileSync(absolute, 'utf8');
	const lines = text.split('\n');
	const internal = internalReason(repoPath);

	let fileMatches = 0;
	lines.forEach((line, index) => {
		const matches = line.match(TOKEN_PATTERN);
		if (matches === null) {
			return;
		}
		fileMatches += matches.length;
		if (internal !== undefined) {
			return;
		}
		const reason = allowanceFor(repoPath, lines, index);
		if (reason !== undefined) {
			allowedMatches += matches.length;
			const shown = line.trim().slice(0, 78);
			write(`  allowed  ${repoPath}:${index + 1}  "${shown}"  — ${reason}`);
			return;
		}
		violations.push({ file: repoPath, line: index + 1, text: line.trim() });
	});

	if (internal !== undefined && fileMatches > 0) {
		allowedFiles.set(repoPath, { count: fileMatches, reason: internal });
		allowedMatches += fileMatches;
	}
}

write('brand-gate: permissions granted');
if (allowedFiles.size === 0) {
	write('  (no internal files carried a brand token)');
}
for (const [file, entry] of allowedFiles) {
	write(`  allowed  ${file}  ${entry.count} match(es)  — ${entry.reason}`);
}

if (violations.length > 0) {
	fail('\nbrand-gate: FAILED');
	for (const violation of violations) {
		fail(`  ${violation.file}:${violation.line}  ${violation.text.slice(0, 100)}`);
	}
	fail(
		`\n${violations.length} unpermitted match(es). Either remove the token, or add a named permission to ALLOWED_LINES in scripts/brand-gate.ts.`,
	);
	process.exit(1);
}

write(`\nbrand-gate: OK — ${allowedMatches} permitted match(es), 0 violations`);
