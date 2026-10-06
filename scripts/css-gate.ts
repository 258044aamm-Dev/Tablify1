/**
 * Stylesheet gate.
 *
 * Five rules from `docs/04`, checked mechanically, because each of them is a rule a reviewer will not see
 * in a diff and a theme author will feel immediately:
 *
 *   1. No bang-important, anywhere — not in a source file, not in the built stylesheet. If a rule loses,
 *      the selector is too long; the old build shipped seven of them and that is why every theme needed a
 *      patch. (Comments are blanked before the check, so a comment may *discuss* it; the source still
 *      writes it as `! important` so a naive grep does not cry wolf.)
 *   2. A colour literal lives in the identity layer of `tokens.css` and nowhere else. Everything else asks
 *      for a token, which is what makes the contrast gate and the host-theme switch possible at all.
 *   3. A `--tablify-*` token is declared in `tokens.css` and nowhere else. One file owns the values; the
 *      components only spend them.
 *   4. None of the shapes `docs/04` §The layout contract forbids: a percentage height, a viewport-height
 *      unit, or a bang-important inside a scrolling layer's geometry. The old build's 15-commit height
 *      chain began with exactly one `height: 100%`.
 *   5. **Every `var(--tablify-…)` a stylesheet asks for, and every `'--tablify-…'` a source file reads by
 *      name, is declared in `tokens.css`.** Rule 3 checks where *declarations* live; this one checks that
 *      the *references* resolve, and it was added by step 27 for a real defect: `grid.css` asked for
 *      `var(--tablify-danger)`, which no token file ever declared. There is no compile error for that —
 *      CSS resolves the fallback (here: none) and the declaration becomes invalid at computed-value time,
 *      so the element silently inherits instead. The large-paste caution in `PasteBlockDialog` was
 *      rendering in ordinary body colour, and nothing in the repo could have noticed.
 *
 *      Read by name in TypeScript too, because `getComputedStyle(el).getPropertyValue('--tablify-…')`
 *      fails just as quietly: `GridView` reads `--tablify-gutter-w` and `--tablify-fill-size`, `measure.ts`
 *      reads `--tablify-header-h`, `keyboardInset.ts` writes `--tablify-keyboard-inset`. All four are
 *      declared; the rule keeps it that way. `harness/**` is deliberately out of scope: it is test
 *      scaffolding, and it sets the inset property itself to fake a keyboard.
 *
 * The zones are the marker comments `tokens.css` carries (`@identity begin/end`, `@semantic`, `@host`).
 * If a marker is renamed, both this gate and `scripts/contrast.ts` say so instead of checking nothing.
 *
 * Run: bun scripts/css-gate.ts        (after `bun run build`)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const STYLE_DIR = 'src/styles';
const TOKEN_FILE = join(STYLE_DIR, 'tokens.css');
const BUILT = 'styles.css';

const write = (line: string): void => void process.stdout.write(`${line}\n`);
const fail = (line: string): void => void process.stderr.write(`${line}\n`);

type Problem = { file: string; line: number; message: string };

const problems: Problem[] = [];
const complain = (file: string, line: number, message: string): void => {
	problems.push({ file, line, message });
};

/** Every `.css` file under `src/styles`, sorted for a stable report. */
function styleFiles(): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(STYLE_DIR, { withFileTypes: true })) {
		const path = join(STYLE_DIR, entry.name);
		if (entry.isDirectory()) continue;
		if (entry.isFile() && entry.name.endsWith('.css')) out.push(path);
	}
	return out.sort();
}

/** The source with every comment replaced by spaces, so line and column numbers still line up. */
function blankComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

const lines = (source: string): string[] => source.split('\n');

const TOKEN_DECLARATION = /(^|[;{\s])--tablify-[\w-]+\s*:/;
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
const BANG_IMPORTANT = /!\s*important/i;
const VIEWPORT_HEIGHT = /\b\d+(?:\.\d+)?(?:vh|dvh|svh|lvh)\b/i;
const PERCENT_HEIGHT = /\bheight\s*:\s*[^;{}]*%/i;
const ZONE_MARKER = /@(identity|semantic|host)\s+(begin|end)\b/g;

/** Every range of `source` that sits inside an `@identity begin` … `@identity end` pair. */
function identityRanges(source: string): { from: number; to: number }[] {
	const out: { from: number; to: number }[] = [];
	ZONE_MARKER.lastIndex = 0;
	let open: number | null = null;
	let hit = ZONE_MARKER.exec(source);
	while (hit !== null) {
		const name = hit[1];
		const kind = hit[2];
		if (name === 'identity' && kind === 'begin') open = hit.index;
		if (name === 'identity' && kind === 'end' && open !== null) {
			out.push({ from: open, to: hit.index });
			open = null;
		}
		hit = ZONE_MARKER.exec(source);
	}
	return out;
}

const inRange = (ranges: { from: number; to: number }[], offset: number): boolean =>
	ranges.some((range) => offset >= range.from && offset <= range.to);

/* ── 1–4, per source file ──────────────────────────────────────────────────── */

const files = styleFiles();
let identityLiterals = 0;
let tokenDeclarationsInTokens = 0;
let tokenDeclarationsElsewhere = 0;

for (const file of files) {
	const source = readFileSync(file, 'utf8');
	const masked = blankComments(source);
	const ranges = identityRanges(source);
	const isTokenFile = file === TOKEN_FILE;

	if (!isTokenFile && ranges.length > 0) {
		complain(
			file,
			1,
			'declares an @identity zone — the identity layer lives in tokens.css only',
		);
	}
	if (isTokenFile && ranges.length === 0) {
		complain(
			file,
			1,
			'has no @identity zone — the palette has to be somewhere, and this is that place',
		);
	}

	const sourceLines = lines(masked);
	for (const [index, text] of sourceLines.entries()) {
		const lineNumber = index + 1;

		if (BANG_IMPORTANT.test(text)) {
			complain(file, lineNumber, 'carries a bang-important — shorten the selector instead');
		}
		if (VIEWPORT_HEIGHT.test(text)) {
			complain(
				file,
				lineNumber,
				'uses a viewport-height unit — the grid fills its host, and on a phone the host is smaller than the viewport',
			);
		}
		if (PERCENT_HEIGHT.test(text)) {
			complain(
				file,
				lineNumber,
				'sets a percentage height — no ancestor of the scroller may negotiate height',
			);
		}

		const token = TOKEN_DECLARATION.exec(text);
		if (token !== null) {
			if (isTokenFile) tokenDeclarationsInTokens += 1;
			else {
				tokenDeclarationsElsewhere += 1;
				complain(
					file,
					lineNumber,
					'declares a --tablify-* token — tokens.css is the only place one may live',
				);
			}
		}

		const literal = COLOUR_LITERAL.exec(text);
		if (literal !== null) {
			// Offsets in the masked text match the source, so the zone test is the source's own markers.
			const offset =
				sourceLines.slice(0, index).join('\n').length +
				(index === 0 ? 0 : 1) +
				literal.index;
			if (isTokenFile && inRange(ranges, offset)) identityLiterals += 1;
			else {
				complain(
					file,
					lineNumber,
					`holds the colour literal "${literal[0]}" outside the identity layer — ask for a token instead`,
				);
			}
		}
	}
}

/* ── 5, repo-wide: every reference resolves to a declaration ───────────────── */

/** Every file under `dir` (recursively) whose name ends with one of `suffixes`, sorted. */
function filesUnder(dir: string, suffixes: readonly string[]): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...filesUnder(path, suffixes));
		else if (suffixes.some((suffix) => entry.name.endsWith(suffix))) out.push(path);
	}
	return out.sort();
}

/** Declared in `tokens.css`, wherever in the file: identity, semantic and host layers all count. */
const TOKEN_NAME_DECLARATION = /(--tablify-[\w-]+)\s*:/g;
const declaredTokens = new Set<string>();
for (const text of lines(blankComments(readFileSync(TOKEN_FILE, 'utf8')))) {
	TOKEN_NAME_DECLARATION.lastIndex = 0;
	let declaration = TOKEN_NAME_DECLARATION.exec(text);
	while (declaration !== null) {
		if (declaration[1] !== undefined) declaredTokens.add(declaration[1]);
		declaration = TOKEN_NAME_DECLARATION.exec(text);
	}
}

const CSS_REFERENCE = /var\(\s*(--tablify-[\w-]+)/g;
const QUOTED_REFERENCE = /['"`](--tablify-[\w-]+)['"`]/g;

/** Every match of `pattern` in `file`, with the line it sits on. Comments are blanked first. */
function referencesIn(file: string, pattern: RegExp): { name: string; line: number }[] {
	const out: { name: string; line: number }[] = [];
	for (const [index, text] of lines(blankComments(readFileSync(file, 'utf8'))).entries()) {
		pattern.lastIndex = 0;
		let hit = pattern.exec(text);
		while (hit !== null) {
			if (hit[1] !== undefined) out.push({ name: hit[1], line: index + 1 });
			hit = pattern.exec(text);
		}
	}
	return out;
}

const referencedFiles = [...files, ...filesUnder('src', ['.ts', '.tsx'])];
let referenceCount = 0;

for (const file of referencedFiles) {
	for (const reference of referencesIn(
		file,
		file.endsWith('.css') ? CSS_REFERENCE : QUOTED_REFERENCE,
	)) {
		referenceCount += 1;
		if (!declaredTokens.has(reference.name)) {
			complain(
				file,
				reference.line,
				`asks for ${reference.name}, which ${TOKEN_FILE} never declares — the value resolves to nothing and the rule silently does nothing`,
			);
		}
	}
}

/* ── the built stylesheet ──────────────────────────────────────────────────── */

let builtBytes = 0;
try {
	const built = readFileSync(BUILT, 'utf8');
	builtBytes = statSync(BUILT).size;
	const masked = blankComments(built);
	if (BANG_IMPORTANT.test(masked)) {
		complain(
			BUILT,
			1,
			'contains a bang-important after the build — the design system forbids it',
		);
	}
	for (const marker of ['--tablify-surface', '.tablify-root', '.tablify-wordmark']) {
		if (!built.includes(marker)) {
			complain(
				BUILT,
				1,
				`is missing "${marker}" — the three @imports in src/styles/index.css did not all land`,
			);
		}
	}
} catch {
	complain(
		BUILT,
		0,
		'does not exist — run `bun run build` first (this gate checks the shipped stylesheet)',
	);
}

/* ── report ────────────────────────────────────────────────────────────────── */

write('');
write(
	`  css gate — ${files.length} file(s) under ${STYLE_DIR}, ${builtBytes} bytes of built ${BUILT}`,
);
write(
	`    ${relative('.', TOKEN_FILE)}: ${tokenDeclarationsInTokens} token declaration(s), ${identityLiterals} colour literal(s)`,
);
write(`    token declarations outside ${relative('.', TOKEN_FILE)}: ${tokenDeclarationsElsewhere}`);
write(
	`    token references resolved: ${referenceCount} in ${referencedFiles.length} file(s) against ${declaredTokens.size} declaration(s)`,
);
write(
	`    identity zones outside ${relative('.', TOKEN_FILE)}: ${
		files.filter(
			(file) => file !== TOKEN_FILE && identityRanges(readFileSync(file, 'utf8')).length > 0,
		).length
	}`,
);
write('');

if (problems.length > 0) {
	fail('  css-gate: FAILED');
	for (const problem of problems) {
		fail(
			`    ${problem.file}${problem.line > 0 ? `:${problem.line}` : ''}  ${problem.message}`,
		);
	}
	fail('');
	process.exit(1);
}

write(
	`  css-gate: OK — no bang-important, ${identityLiterals} colour literal(s) all inside the identity layer,`,
);
write(
	`  every --tablify-* token declared in ${relative('.', TOKEN_FILE)} and every reference resolving to one,`,
);
write('  no percentage or viewport heights');
write('');
