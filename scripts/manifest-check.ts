/**
 * Manifest gate — the release facts must agree before anything is published.
 *
 * Obsidian's reviewer sees `manifest.json` first, then `versions.json`, then `CHANGELOG.md`. If those
 * three disagree, the release is rejected; if `description` drifts into marketing or names another
 * company, the submission is a trademark problem. Both are cheaper to catch here than there.
 *
 * Exit code 0 only when every check passes. One line per failure, naming the file and the value.
 */
import { existsSync, readFileSync } from 'node:fs';

const write = (line: string): void => void process.stdout.write(`${line}\n`);
const fail = (line: string): void => void process.stderr.write(`${line}\n`);

const BANNED_TOKENS = /\b(anthropic|claude|airtable|notion)\b/i;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const ID_PATTERN = /^[a-z0-9-]+$/;

const failures: string[] = [];
const check = (condition: boolean, message: string): void => {
	if (condition) {
		write(`  ok    ${message}`);
		return;
	}
	failures.push(message);
	fail(`  FAIL  ${message}`);
};

function readJson(path: string): unknown {
	if (!existsSync(path)) {
		failures.push(`${path} is missing`);
		fail(`  FAIL  ${path} is missing`);
		return undefined;
	}
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		failures.push(`${path} is not valid JSON`);
		fail(`  FAIL  ${path} is not valid JSON: ${detail}`);
		return undefined;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** Compare two `x.y.z` versions numerically; returns false when either side is malformed. */
function isNewer(candidate: string, reference: string): boolean {
	if (!VERSION_PATTERN.test(candidate) || !VERSION_PATTERN.test(reference)) {
		return false;
	}
	const left = candidate.split('.').map(Number);
	const right = reference.split('.').map(Number);
	for (let i = 0; i < 3; i += 1) {
		const a = left[i] ?? 0;
		const b = right[i] ?? 0;
		if (a !== b) {
			return a > b;
		}
	}
	return false;
}

write('manifest:check');

const manifest = readJson('manifest.json');
if (isRecord(manifest)) {
	const id = manifest['id'];
	const name = manifest['name'];
	const version = manifest['version'];
	const minAppVersion = manifest['minAppVersion'];
	const description = manifest['description'];
	const isDesktopOnly = manifest['isDesktopOnly'];

	check(
		typeof id === 'string' && ID_PATTERN.test(id),
		`id matches ^[a-z0-9-]+$ (got ${String(id)})`,
	);
	check(typeof id === 'string' && !id.includes('obsidian'), 'id does not contain "obsidian"');
	check(typeof name === 'string' && name.length > 0, `name is not empty (got ${String(name)})`);
	check(
		typeof name === 'string' && !BANNED_TOKENS.test(name),
		'name contains no third-party brand token',
	);
	check(
		typeof version === 'string' && VERSION_PATTERN.test(version),
		`version is x.y.z (got ${String(version)})`,
	);
	check(
		typeof minAppVersion === 'string' && VERSION_PATTERN.test(minAppVersion),
		`minAppVersion is x.y.z (got ${String(minAppVersion)})`,
	);
	check(typeof isDesktopOnly === 'boolean', 'isDesktopOnly is a boolean');

	check(
		typeof description === 'string' && description.length <= 250,
		`description is at most 250 characters (got ${typeof description === 'string' ? description.length : 'no string'})`,
	);
	check(
		typeof description === 'string' && !BANNED_TOKENS.test(description),
		'description contains no third-party brand token',
	);
	check(
		typeof description === 'string' && !/\bobsidian\b/i.test(description),
		'description does not contain the word "obsidian"',
	);
	check(
		typeof description === 'string' && /[.?!)]$/.test(description.trim()),
		'description ends with punctuation',
	);

	// CHANGELOG.md: the top version heading must be the manifest version.
	let changelogVersion: string | undefined;
	if (existsSync('CHANGELOG.md')) {
		const changelog = readFileSync('CHANGELOG.md', 'utf8');
		const heading = /^##\s+\[(\d+\.\d+\.\d+)\]/m.exec(changelog);
		changelogVersion = heading?.[1];
		check(changelogVersion !== undefined, 'CHANGELOG.md has a "## [x.y.z]" heading');
		check(
			changelogVersion !== undefined && changelogVersion === version,
			`CHANGELOG.md top version equals manifest version (${String(changelogVersion)} vs ${String(version)})`,
		);
	} else {
		check(false, 'CHANGELOG.md exists');
	}

	// versions.json: newest key is the manifest version, every value is a plausible minAppVersion.
	const versions = readJson('versions.json');
	if (isRecord(versions)) {
		const keys = Object.keys(versions);
		check(keys.length > 0, 'versions.json has at least one entry');
		check(
			keys.every((key) => VERSION_PATTERN.test(key)),
			'every versions.json key is x.y.z',
		);
		const values = Object.values(versions);
		check(
			values.every((value) => typeof value === 'string' && VERSION_PATTERN.test(value)),
			'every versions.json value is a valid minAppVersion',
		);

		let newest: string | undefined;
		for (const key of keys) {
			if (newest === undefined || isNewer(key, newest)) {
				newest = key;
			}
		}
		check(
			newest !== undefined && newest === version,
			`newest versions.json key equals manifest version (${String(newest)} vs ${String(version)})`,
		);
		if (newest !== undefined && typeof minAppVersion === 'string') {
			const mapped = versions[newest];
			check(
				typeof mapped === 'string' && mapped === minAppVersion,
				`versions.json["${newest}"] equals manifest minAppVersion (${String(mapped)} vs ${minAppVersion})`,
			);
		}
	}
}

if (failures.length > 0) {
	fail(`\nmanifest:check: FAILED — ${failures.length} problem(s)`);
	process.exit(1);
}

write('\nmanifest:check: OK');
