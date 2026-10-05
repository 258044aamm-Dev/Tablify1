/**
 * Version bump — one command, four files, no git.
 *
 * `manifest.json`, `package.json`, `CHANGELOG.md` and `versions.json` must agree or Obsidian's review
 * rejects the release (`scripts/manifest-check.ts` enforces the same rule in `bun run check`). Bumping
 * them by hand is exactly the kind of task that silently goes half-done, so it lives here.
 *
 * Run: bun scripts/version-bump.ts patch|minor|major
 * It never commits and never tags; publishing stays a deliberate, separate step.
 */
import { readFileSync, writeFileSync } from 'node:fs';

type Bump = 'patch' | 'minor' | 'major';

const write = (line: string): void => void process.stdout.write(`${line}\n`);
const fail = (line: string): void => void process.stderr.write(`${line}\n`);

const BUMPS: readonly Bump[] = ['patch', 'minor', 'major'];
const REPO = 'https://github.com/258044aamm-Dev/Tablify';

const requested = process.argv[2];
const bump = BUMPS.find((candidate) => candidate === requested);
if (bump === undefined) {
	fail(`version-bump: expected one of ${BUMPS.join(', ')} (got "${String(requested)}")`);
	process.exit(1);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function readJson(path: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
	if (!isRecord(parsed)) {
		fail(`version-bump: ${path} is not a JSON object`);
		process.exit(1);
	}
	return parsed;
}

function writeJson(path: string, value: Record<string, unknown>): void {
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
}

function nextVersion(current: string, kind: Bump): string {
	const parts = current.split('.').map(Number);
	const [major = 0, minor = 0, patch = 0] = parts;
	if (kind === 'major') {
		return `${major + 1}.0.0`;
	}
	if (kind === 'minor') {
		return `${major}.${minor + 1}.0`;
	}
	return `${major}.${minor}.${patch + 1}`;
}

const manifest = readJson('manifest.json');
const current = manifest['version'];
const minAppVersion = manifest['minAppVersion'];
if (typeof current !== 'string' || typeof minAppVersion !== 'string') {
	fail('version-bump: manifest.json must declare string version and minAppVersion fields');
	process.exit(1);
}

const next = nextVersion(current, bump);
const today = new Date().toISOString().slice(0, 10);

// marker:1 manifest.json
manifest['version'] = next;
writeJson('manifest.json', manifest);

// marker:2 package.json
const pkg = readJson('package.json');
pkg['version'] = next;
writeJson('package.json', pkg);

// marker:3 versions.json — the new version maps to the current minAppVersion, and every earlier
// mapping is preserved, because Obsidian reads this file to decide what it can install where.
const versions = readJson('versions.json');
versions[next] = minAppVersion;
writeJson('versions.json', versions);

// marker:4 CHANGELOG.md — a dated heading above the previous one, plus its link reference.
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const heading = `## [${next}] - ${today}`;
if (changelog.includes(heading)) {
	fail(`version-bump: CHANGELOG.md already has a ${heading} heading`);
	process.exit(1);
}
const withHeading = changelog.replace(/^## \[/m, `${heading}\n\n## [`);
const linkLine = `[${next}]: ${REPO}/releases/tag/${next}`;
const withLink = withHeading.replace(/^\[0\./m, `${linkLine}\n[0.`);
writeFileSync('CHANGELOG.md', withLink);

write(
	`version-bump: ${current} → ${next} (${bump}) — manifest.json, package.json, versions.json and CHANGELOG.md updated; nothing committed, nothing tagged.`,
);
write(`version-bump: add your entries under "${heading}" before you release.`);
