/**
 * R3 identity inventory — read-only, and the first deliverable of R3 step 1.
 *
 * The R3 guide is explicit: before any identity is replaced, "generate a read-only search inventory
 * and classify each match: a) row identity to replace, b) host path that remains for locating the
 * database/attachment, c) remote Airtable identifier that remains, d) historical test/document
 * string." This script does exactly that, and nothing else — it never writes source.
 *
 * The classification is **data**, not judgement at run time: `RULES` maps a path prefix to a class
 * and a reason, the longest matching prefix wins, and a file with matches that no rule covers is a
 * failure. That failure is the point: it makes the *next* file to grow a legacy identity marker a
 * decision somebody has to take, rather than a match nobody noticed.
 *
 * Usage:
 *   bun scripts/r3-inventory.ts           # print the report (exit 1 if anything is unclassified)
 *   bun scripts/r3-inventory.ts --write   # write the committed report
 *   bun scripts/r3-inventory.ts --check   # exit 1 if the committed report is out of date
 *
 * `tests/unit/r3-inventory.test.ts` imports the functions below and holds the committed report to
 * the same bytes this script renders, so the inventory cannot drift away from the tree it describes.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/** Where the committed report lives. Markdown is hand-wrapped here; this file writes it verbatim. */
export const REPORT_PATH = join('docs', 'audit', 'R3-identity-inventory.md');

/** The trees the inventory covers: shipped source and the tests that assert its behaviour. */
const SCAN_DIRS: readonly string[] = ['src', 'tests'];

/** Only text is scanned, so no binary artefact can produce a page of noise. */
const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'coverage',
	'dist',
	'playwright-report',
	'.bun',
]);

/**
 * The markers that mean "this line still believes a row is a note, or a field is a Bases property".
 * Each pattern is anchored on the identifier, not on prose: the inventory's counts are about code.
 *
 * What is deliberately **not** a marker: the text codecs (`parsePlain`/`formatPlain`) and the query,
 * selection and clipboard modules. Those are being *kept* — R3 step 3 preserves the interchange
 * semantics — and putting them in a list of things to replace is how a refactor loses them.
 */
export const MARKERS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
	{ name: 'filePath', pattern: /\bfilePath\b/g },
	{ name: 'PropertyId', pattern: /\bPropertyId\b/g },
	{ name: 'propertyId', pattern: /\bpropertyId\b/g },
	{ name: 'YamlValue', pattern: /\bYamlValue\b/g },
	{ name: 'toYaml', pattern: /\btoYaml\b/g },
	{ name: 'RowSource', pattern: /\bRowSource\b/g },
	{ name: 'processFrontMatter', pattern: /\bprocessFrontMatter\b/g },
	{ name: 'metadataCache', pattern: /\bmetadataCache\b/g },
	{ name: 'getFileCache', pattern: /\bgetFileCache\b/g },
];

/**
 * Every class name, in the order the report lists them. The union type is derived from this list and
 * the map below is keyed by it, so a class cannot exist in one and be missing from the other.
 */
export const CLASS_NAMES = [
	'replace',
	'host-path',
	'remote-record-id',
	'historical',
	'guard',
	'native',
] as const;

/** The class union. */
export type InventoryClass = (typeof CLASS_NAMES)[number];

/** What each class means, and who owns the match when R3 is done. */
export const CLASSES: { readonly [Name in InventoryClass]: string } = {
	/**
	 * a) Identity to replace. The match *is* the old identity: a row addressed by note path, a field
	 * addressed by property name. R3 replaces these with `RowId`/`FieldId` and stable table context.
	 */
	replace: 'row/field identity to replace with stable document ids',
	/**
	 * b) Host path that remains. A vault-relative path used to *find* a file — the database itself or
	 * an attachment. R3 keeps these, at explicit host boundaries only.
	 */
	'host-path': 'host file/attachment address that remains, at a boundary',
	/**
	 * c) Remote record identifier that remains. The sync service's own record ids are its identity,
	 * not ours; R3 leaves them alone (and stays out of the sync module's way).
	 */
	'remote-record-id': 'remote record identifier that remains',
	/**
	 * d) Historical string. Test text, fixtures and fakes that describe the Bases era on purpose: the
	 * legacy view keeps working until R6, and its tests must keep saying what it does.
	 */
	historical: 'historical or legacy-era string kept until R6',
	/**
	 * The one legitimate mention in a test: a marker named *in order to forbid it*. The name is not an
	 * identity here, and pretending otherwise would make the guard itself look like a defect.
	 */
	guard: 'names a marker to forbid it; not an identity',
	/**
	 * e) The R2 native path, which must contain **no** marker at all. A match here is a defect, and
	 * the report says so loudly instead of classifying it away.
	 */
	native: 'native path — a marker here is a defect, not a classification',
} as const;

/**
 * The rule table. Longest matching prefix wins, so a specific file or folder can be classified
 * without disturbing its parents. Paths are repository-relative and always use forward slashes.
 */
export const RULES: readonly {
	readonly prefix: string;
	readonly cls: InventoryClass;
	readonly why: string;
}[] = [
	// The native path first: it must stay clean, and these prefixes are the baseline the report states.
	{
		prefix: 'tests/unit/view-state.test.ts',
		cls: 'guard',
		why: 'The scan that forbids these names.',
	},
	{
		prefix: 'tests/unit/value-vocabulary.test.ts',
		cls: 'guard',
		why: 'R3 step 3: the same kind of scan for the YAML vocabulary, naming what it forbids.',
	},
	{
		prefix: 'src/adapters/tablifyFile/',
		cls: 'native',
		why: 'R2 file I/O: documents, not notes.',
	},
	{
		prefix: 'src/core/database/',
		cls: 'native',
		why: 'R1 document model and its commands: ids, never paths.',
	},
	{
		prefix: 'src/plugin/viewState.ts',
		cls: 'native',
		why: 'R2 step 7 view-state policy: it names where state lives, never a note.',
	},
	{
		prefix: 'src/plugin/TablifyFileView.ts',
		cls: 'native',
		why: 'R2 file view: it shows a document through the file port.',
	},
	{
		prefix: 'src/sync/',
		cls: 'remote-record-id',
		why: "The sync module speaks the service's own record ids; R3 does not rename them.",
	},
	{
		prefix: 'src/adapters/notes/',
		cls: 'host-path',
		why: 'Attachment and note addressing is a host concern that outlives the refactor.',
	},
	{
		prefix: 'src/adapters/',
		cls: 'replace',
		why: 'Bases-era adapters: note-path row identity and frontmatter writes that R3 replaces.',
	},
	{
		prefix: 'src/core/fieldTypes/',
		cls: 'replace',
		why: 'Descriptor `toYaml`: replaced by JSON encode/decode (step 3); the text semantics stay.',
	},
	{
		prefix: 'src/core/',
		cls: 'replace',
		why: 'The grid core whose row/field identity R3 replaces with stable document ids.',
	},
	{
		prefix: 'src/grid/',
		cls: 'replace',
		why: 'The grid reads and edits those identities; it follows the core, it does not keep its own.',
	},
	{
		prefix: 'src/plugin/',
		cls: 'replace',
		why: 'Bases-era plugin surfaces that R3/R5 generalize and R6 removes.',
	},
	{
		prefix: 'tests/',
		cls: 'historical',
		why: 'Test text: the legacy path must keep its own vocabulary until R6 removes it.',
	},
];

export interface FileMatches {
	readonly path: string;
	readonly counts: ReadonlyMap<string, number>;
	readonly total: number;
}

export interface Inventory {
	readonly files: readonly FileMatches[];
	readonly unclassified: readonly string[];
	readonly classOf: (path: string) => InventoryClass | undefined;
	readonly uncategorised: readonly string[];
}

/** Which class a path belongs to, by the longest matching rule prefix. */
export function classify(path: string): { cls: InventoryClass; why: string } | undefined {
	let best: { prefix: string; cls: InventoryClass; why: string } | undefined;
	for (const rule of RULES) {
		if (path === rule.prefix || path.startsWith(rule.prefix)) {
			if (best === undefined || rule.prefix.length > best.prefix.length) {
				best = rule;
			}
		}
	}
	return best === undefined ? undefined : { cls: best.cls, why: best.why };
}

function walk(dir: string, out: string[]): void {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		if (SKIP_DIRS.has(entry)) {
			continue;
		}
		const full = join(dir, entry);
		const info = statSync(full);
		if (info.isDirectory()) {
			walk(full, out);
			continue;
		}
		if (full.endsWith('.ts') || full.endsWith('.tsx')) {
			out.push(relative(ROOT, full).split(sep).join('/'));
		}
	}
}

/** Scan the tree and count every marker in every file. Pure apart from reading the tree. */
export function scanInventory(): Inventory {
	const files: string[] = [];
	for (const dir of SCAN_DIRS) {
		walk(dir, files);
	}
	files.sort();

	const found: FileMatches[] = [];
	const unclassified: string[] = [];
	const uncategorised: string[] = [];
	for (const path of files) {
		const text = readFileSync(path, 'utf8');
		const counts = new Map<string, number>();
		let total = 0;
		for (const marker of MARKERS) {
			const matches = text.match(marker.pattern);
			if (matches !== null) {
				counts.set(marker.name, matches.length);
				total += matches.length;
			}
		}
		if (total === 0) {
			// A file without markers needs no class: there is nothing to decide about it.
			continue;
		}
		found.push({ path, counts, total });
		const rule = classify(path);
		if (rule === undefined) {
			uncategorised.push(path);
			continue;
		}
		if (rule.cls === 'native') {
			unclassified.push(path);
		}
	}

	return {
		files: found,
		unclassified,
		classOf: (path: string): InventoryClass | undefined => classify(path)?.cls,
		uncategorised,
	};
}

/** Render the report. Deterministic: same tree in, same bytes out. */
export function renderReport(inventory: Inventory): string {
	const byClass = new Map<InventoryClass, FileMatches[]>();
	const rows = inventory.files.filter((file) => inventory.classOf(file.path) !== 'native');
	for (const file of rows) {
		const cls = inventory.classOf(file.path);
		if (cls === undefined) {
			continue;
		}
		const list = byClass.get(cls) ?? [];
		list.push(file);
		byClass.set(cls, list);
	}

	const lines: string[] = [];
	lines.push('# R3 identity inventory — where the old identity still lives');
	lines.push('');
	lines.push(
		'Generated by `bun scripts/r3-inventory.ts --write`; `tests/unit/r3-inventory.test.ts` fails if',
	);
	lines.push(
		'this file and a fresh scan disagree. Every match of every marker is classified, and a',
	);
	lines.push(
		'file that matches a marker outside the R2 native path and outside this table is a **failure**',
	);
	lines.push(
		'of the script, not a footnote — classifying it is the decision R3 step 1 exists to force.',
	);
	lines.push('');
	lines.push('| Class | Meaning |');
	lines.push('| --- | --- |');
	for (const [name, meaning] of Object.entries(CLASSES)) {
		lines.push(`| \`${name}\` | ${meaning} |`);
	}
	lines.push('');
	lines.push('## Files, with the markers they carry');
	lines.push('');
	for (const name of CLASS_NAMES) {
		const list = byClass.get(name) ?? [];
		if (name === 'native' || list.length === 0) {
			continue;
		}
		const rule = RULES.filter((candidate) => candidate.cls === name).map(
			(candidate) => candidate.prefix,
		);
		lines.push(`### \`${name}\` — ${list.length} file(s)`);
		lines.push('');
		lines.push(`Rule: \`${rule.join('`, `')}\``);
		lines.push('');
		lines.push('| File | Matches |');
		lines.push('| --- | --- |');
		for (const file of list) {
			const counts = [...file.counts.entries()]
				.map(([marker, count]) => `${marker} ×${count}`)
				.join(', ');
			lines.push(`| \`${file.path}\` | ${counts} |`);
		}
		lines.push('');
	}
	lines.push('## Totals');
	lines.push('');
	const total = inventory.files.reduce((sum, file) => sum + file.total, 0);
	const files = inventory.files.length;
	lines.push(`${String(files)} files carry ${String(total)} marker occurrences.`);
	lines.push('');
	for (const name of CLASS_NAMES) {
		const list = byClass.get(name) ?? [];
		const occurrences = list.reduce((sum, file) => sum + file.total, 0);
		lines.push(
			`- \`${name}\`: ${String(list.length)} file(s), ${String(occurrences)} occurrence(s)`,
		);
	}
	lines.push('');
	lines.push('## The native path');
	lines.push('');
	lines.push(
		'`src/core/database/**`, `src/adapters/tablifyFile/**`, `src/plugin/TablifyFileView.ts` and',
	);
	lines.push(
		'`src/plugin/viewState.ts` carry **zero** markers. That is the R1/R2 baseline R3 must not break:',
	);
	lines.push('the document model has never known what a note is.');
	lines.push('');
	if (inventory.unclassified.length > 0) {
		lines.push('## Markers inside the native path — defects');
		lines.push('');
		for (const path of inventory.unclassified) {
			lines.push(`- \`${path}\``);
		}
		lines.push('');
	}
	return `${lines.join('\n')}\n`;
}

const invokedDirectly = process.argv[1]?.endsWith('r3-inventory.ts') ?? false;

if (invokedDirectly) {
	const inventory = scanInventory();
	const report = renderReport(inventory);

	if (process.argv.includes('--write')) {
		writeFileSync(REPORT_PATH, report);
		process.stdout.write(`wrote ${REPORT_PATH}\n`);
	} else if (process.argv.includes('--check')) {
		const committed = readFileSync(REPORT_PATH, 'utf8');
		if (committed !== report) {
			process.stderr.write(
				`${REPORT_PATH} is out of date; run \`bun scripts/r3-inventory.ts --write\`\n`,
			);
			process.exit(1);
		}
		process.stdout.write(`${REPORT_PATH} is current\n`);
	} else {
		process.stdout.write(report);
	}

	if (inventory.unclassified.length > 0) {
		process.stderr.write(
			`${String(inventory.unclassified.length)} native-path file(s) carry a legacy marker:\n${inventory.unclassified.join('\n')}\n`,
		);
		process.exit(1);
	}
	if (inventory.uncategorised.length > 0) {
		process.stderr.write(
			`${String(inventory.uncategorised.length)} path(s) have no classification rule at all:\n${inventory.uncategorised.join('\n')}\n`,
		);
		process.exit(1);
	}
}
