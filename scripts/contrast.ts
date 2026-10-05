/**
 * Contrast gate for the design tokens.
 *
 * `docs/04` §Tier 2: "Every text/background pair must pass WCAG AA (4.5:1 for body text, 3:1 for icons
 * and boundaries) in both light and dark. Verify before merging a palette change." This is that check,
 * run in `bun run check` and in CI, so a palette change cannot merge on a screenshot.
 *
 * It reads the `@contrast <fg> on <bg> min <ratio>` declarations in `src/styles/tokens.css`, resolves
 * every token through its `var()` aliases, and computes the WCAG 2.1 ratio for four modes:
 *
 *   light       the identity palette plus the semantic layer, as declared on `:root`
 *   dark        the same, with every `:root.theme-dark` block applied over it
 *   host-light  `body.tablify-host-theme` over `:root`, resolved against HOST_FIXTURE.light
 *   host-dark   the same, against HOST_FIXTURE.dark
 *
 * light and dark are **gated**: they are our palette, and a pair below its minimum exits 1. The two host
 * columns are **reported**: those values belong to whatever theme the user installed, and gating someone
 * else's palette would fail every theme but the one in the fixture. What *is* gated in host mode is
 * resolution — a pair whose tokens do not resolve means the host block forgot a variable, and that is a
 * failure. `HOST_FIXTURE` is a stand-in theme under Obsidian's variable names, not a copy of anyone's
 * published theme: the columns exist to show that host mode delegates, not to certify a theme.
 *
 * `@contrast-info` pairs are decorative (a hairline, a wash) and are printed, never gated.
 *
 * Which text is read is decided by the markers tokens.css carries — `@identity begin/end`,
 * `@semantic begin/end`, `@host begin/end`. That is deliberate: identity is the only zone a colour
 * literal may live in, and `scripts/css-gate.ts` enforces exactly that, so if a marker is renamed both
 * gates say so loudly instead of quietly checking nothing.
 *
 * Run: bun scripts/contrast.ts [--all]      (--all prints the informational rows too)
 * No dependencies: the colour maths is thirty lines and we are not adding one for it.
 */
import { readFileSync } from 'node:fs';

const TOKENS = 'src/styles/tokens.css';
const PRINT_ALL = process.argv.includes('--all');

type Rgb = readonly [number, number, number];
type Colour = { rgb: Rgb; a: number };
type ModeName = 'light' | 'dark' | 'host-light' | 'host-dark';

type Declaration = { fg: string; bg: string; min: number | null; info: boolean };
type Mode = { name: ModeName; tokens: Map<string, string>; gated: boolean };

/** A stand-in host theme: Obsidian's variable names, representative values, light and dark. */
const HOST_FIXTURE: { light: Record<string, string>; dark: Record<string, string> } = {
	light: {
		'--background-primary': '#ffffff',
		'--background-secondary': '#f4f5f7',
		'--background-modifier-border': '#dcdfe4',
		'--background-modifier-border-focus': '#a9aeb6',
		'--background-modifier-hover': '#eceef1',
		'--background-modifier-active-hover': '#e3e6ea',
		'--text-normal': '#2f3338',
		'--text-muted': '#696f76',
		'--text-faint': '#9aa0a6',
		'--text-accent': '#6f5bd8',
		'--text-success': '#1f7a43',
		'--text-error': '#b3382c',
		'--interactive-accent': '#7a5fd0',
		'--interactive-hover': '#6c52c4',
		'--text-on-accent': '#ffffff',
		'--overlay-bg': 'rgba(0, 0, 0, 0.5)',
	},
	dark: {
		'--background-primary': '#1e1e1e',
		'--background-secondary': '#262626',
		'--background-modifier-border': '#3d3d3d',
		'--background-modifier-border-focus': '#5f5f5f',
		'--background-modifier-hover': '#2f2f2f',
		'--background-modifier-active-hover': '#3a3a3a',
		'--text-normal': '#dcddde',
		'--text-muted': '#b0b3b6',
		'--text-faint': '#8a8d90',
		'--text-accent': '#a08cf0',
		'--text-success': '#5cbb85',
		'--text-error': '#e0736a',
		'--interactive-accent': '#8b76e0',
		'--interactive-hover': '#9d8ae6',
		'--text-on-accent': '#1e1e1e',
		'--overlay-bg': 'rgba(0, 0, 0, 0.6)',
	},
};

const write = (line: string): void => void process.stdout.write(`${line}\n`);
const fail = (line: string): void => void process.stderr.write(`${line}\n`);
const pad = (text: string, width: number): string => text.padEnd(width);

/* ── reading the stylesheet ────────────────────────────────────────────────── */

const css = readFileSync(TOKENS, 'utf8');

/** Everything between each `@name begin` marker and its matching `@name end` marker. */
function zoneText(source: string, name: string): string {
	const parts: string[] = [];
	const endMarker = `@${name} end`;
	const begin = new RegExp(`@${name} begin`, 'g');
	let hit = begin.exec(source);
	while (hit !== null) {
		const end = source.indexOf(endMarker, hit.index);
		if (end === -1) break;
		parts.push(source.slice(hit.index, end));
		begin.lastIndex = end + endMarker.length;
		hit = begin.exec(source);
	}
	return parts.join('\n');
}

/** The body of every rule whose selector is exactly `selector`, within `source`. */
function blocksFor(source: string, selector: string): string[] {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// `m` so `^` matches a line start: every selector this reads sits at the top level of the file, with a
	// comment above it — which a plain `^` (string start only) and a `[},;]` lookbehind both miss.
	const re = new RegExp(`(?:^|[};])\\s*${escaped}\\s*\\{`, 'gm');
	const out: string[] = [];
	let hit = re.exec(source);
	while (hit !== null) {
		const open = hit.index + hit[0].length - 1;
		let depth = 0;
		let end = -1;
		for (let i = open; i < source.length; i += 1) {
			if (source[i] === '{') depth += 1;
			else if (source[i] === '}') {
				depth -= 1;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		if (end === -1) break;
		out.push(source.slice(open + 1, end));
		re.lastIndex = end + 1;
		hit = re.exec(source);
	}
	return out;
}

/** Prettier wraps a long value (a curve, a three-part shadow) onto its own lines and pads the inside of
 * its parentheses; a wrapped `rgba(` would otherwise read as "unresolved", so both are normalised away. */
const flatten = (value: string): string =>
	value.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();

/** Every `--token: value` declaration in the given rule bodies, comments removed, later blocks winning. */
function tokenMap(bodies: string[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const body of bodies) {
		const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, '');
		for (const piece of withoutComments.split(';')) {
			const match = /(--[\w-]+)\s*:\s*([\s\S]+)/.exec(piece);
			if (match?.[1] !== undefined && match[2] !== undefined)
				out.set(match[1], flatten(match[2]));
		}
	}
	return out;
}

const identityZone = zoneText(css, 'identity');
const semanticZone = zoneText(css, 'semantic');
const hostZone = zoneText(css, 'host');

for (const [name, text] of [
	['@identity', identityZone],
	['@semantic', semanticZone],
	['@host', hostZone],
] as const) {
	if (text.trim().length === 0) {
		fail(
			`contrast: the ${name} zone is missing from ${TOKENS} — the markers are what the gates read.`,
		);
		process.exit(1);
	}
}

/** Later maps win. (Not `Object.assign`: these are Maps, and spreading one into an object loses entries.) */
const merged = (...maps: Map<string, string>[]): Map<string, string> => {
	const out = new Map<string, string>();
	for (const map of maps) for (const [key, value] of map) out.set(key, value);
	return out;
};

const lightTokens = merged(
	tokenMap(blocksFor(identityZone, ':root')),
	tokenMap(blocksFor(semanticZone, ':root')),
);
const darkTokens = merged(lightTokens, tokenMap(blocksFor(identityZone, ':root.theme-dark')));
const hostBase = merged(lightTokens, tokenMap(blocksFor(hostZone, 'body.tablify-host-theme')));
const fixture = (theme: Record<string, string>): Map<string, string> =>
	new Map(Object.entries(theme));

const MODES: Mode[] = [
	{ name: 'light', tokens: lightTokens, gated: true },
	{ name: 'dark', tokens: darkTokens, gated: true },
	{ name: 'host-light', tokens: merged(hostBase, fixture(HOST_FIXTURE.light)), gated: false },
	{ name: 'host-dark', tokens: merged(hostBase, fixture(HOST_FIXTURE.dark)), gated: false },
];

/* ── colour maths (WCAG 2.1) ───────────────────────────────────────────────── */

function parseColour(value: string): Colour | null {
	const text = value.trim();
	const short = /^#([0-9a-f]{3})$/i.exec(text);
	if (short?.[1] !== undefined) {
		const digits = short[1];
		const channel = (i: number): number =>
			parseInt(`${digits[i] ?? '0'}${digits[i] ?? '0'}`, 16);
		return { rgb: [channel(0), channel(1), channel(2)], a: 1 };
	}
	const long = /^#([0-9a-f]{6})$/i.exec(text);
	if (long?.[1] !== undefined) {
		const digits = long[1];
		const channel = (i: number): number => parseInt(digits.slice(i, i + 2), 16);
		return { rgb: [channel(0), channel(2), channel(4)], a: 1 };
	}
	const functional = /^rgba?\(([^)]+)\)$/i.exec(text);
	if (functional?.[1] !== undefined) {
		const parts = functional[1].split(/[,/]/).map((piece) => parseFloat(piece.trim()));
		const [r, g, b, a] = parts;
		if (r === undefined || g === undefined || b === undefined) return null;
		return { rgb: [r, g, b], a: a === undefined ? 1 : a };
	}
	return null;
}

/** A translucent colour, composited over an opaque one. */
function over(colour: Colour, background: Rgb): Rgb {
	const channel = (i: number): number =>
		Math.round((colour.rgb[i] ?? 0) * colour.a + (background[i] ?? 0) * (1 - colour.a));
	return [channel(0), channel(1), channel(2)];
}

function luminance(rgb: Rgb): number {
	const channel = [0, 1, 2].map((i) => {
		const value = (rgb[i] ?? 0) / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * (channel[0] ?? 0) + 0.7152 * (channel[1] ?? 0) + 0.0722 * (channel[2] ?? 0);
}

function ratio(a: Rgb, b: Rgb): number {
	const first = luminance(a);
	const second = luminance(b);
	return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Follows `var()` aliases to something concrete; `null` when the chain leaves the file. */
function resolve(tokens: Map<string, string>, name: string, depth = 0): string | null {
	if (depth > 12) return null;
	const value = tokens.get(name);
	if (value === undefined) return null;
	const alias = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(value);
	if (alias?.[1] === undefined) return value;
	const followed = resolve(tokens, alias[1], depth + 1);
	if (followed !== null) return followed;
	return alias[2] === undefined ? null : alias[2].trim();
}

/* ── the declared pairs ────────────────────────────────────────────────────── */

const declarations: Declaration[] = [];
const declarationRe = /@contrast(-info)?\s+(--[\w-]+)\s+on\s+(--[\w-]+)(?:\s+min\s+([\d.]+))?/g;
for (const match of css.matchAll(declarationRe)) {
	const [, info, fg, bg, min] = match;
	if (fg === undefined || bg === undefined) continue;
	declarations.push({
		fg,
		bg,
		min: min === undefined ? null : parseFloat(min),
		info: info !== undefined,
	});
}

const gatedPairs = declarations.filter(
	(declaration) => !declaration.info && declaration.min !== null,
);
const label = (declaration: Declaration): string => `${declaration.fg} on ${declaration.bg}`;
const width = Math.max(30, ...declarations.map((declaration) => label(declaration).length)) + 3;

/* ── report ────────────────────────────────────────────────────────────────── */

write('');
write(`  Tablify contrast gate — ${declarations.length} declared pairs × ${MODES.length} modes`);
write(`  gated: light, dark — our palette · reported: host-light, host-dark — the fixture theme`);
write(
	`  tokens read: ${lightTokens.size} in light, ${darkTokens.size} in dark, ${hostBase.size} in host mode`,
);
write('');
write(`  ${pad('pair', width)}${pad('mode', 12)}${pad('ratio', 8)}${pad('min', 6)}result`);
write(`  ${'─'.repeat(width + 34)}`);

let gatedChecks = 0;
let gatedFailed = 0;
let unresolvedGated = 0;
const hostGaps: string[] = [];
const hostBelow: string[] = [];

for (const declaration of declarations) {
	const informational = declaration.info || declaration.min === null;
	for (const mode of MODES) {
		const fgRaw = resolve(mode.tokens, declaration.fg);
		const bgRaw = resolve(mode.tokens, declaration.bg);
		const background = bgRaw === null ? null : parseColour(bgRaw);
		const foreground = fgRaw === null ? null : parseColour(bgRaw === null ? '' : fgRaw);
		const row = `${pad(label(declaration), width)}${pad(mode.name, 12)}`;

		if (background === null || foreground === null) {
			// Unresolved. In light and dark that is fatal for a gated pair (a token is missing);
			// in host mode it means the host block points at a variable the fixture does not define.
			const fatal = mode.gated && !informational;
			if (fatal) unresolvedGated += 1;
			else hostGaps.push(`${label(declaration)} [${mode.name}]`);
			write(
				`${row}${pad('—', 8)}${pad(String(declaration.min ?? 'info'), 6)}${
					fatal ? '✗ UNRESOLVED' : '· not in the fixture'
				}`,
			);
			continue;
		}

		const bg = over(background, [255, 255, 255]);
		const value = ratio(over(foreground, bg), bg);
		const shown = value.toFixed(2);
		const minimum = declaration.min ?? 0;
		const pass = value >= minimum - 0.005;

		if (informational) {
			if (PRINT_ALL)
				write(
					`${row}${pad(shown, 8)}${pad('info', 6)}${pass ? '·' : '· (low, decorative)'}`,
				);
			continue;
		}

		if (mode.gated) {
			gatedChecks += 1;
			if (!pass) gatedFailed += 1;
			write(`${row}${pad(shown, 8)}${pad(String(minimum), 6)}${pass ? '✓' : '✗ FAILS'}`);
		} else {
			if (!pass)
				hostBelow.push(
					`${label(declaration)} [${mode.name}] ${shown} < ${String(minimum)}`,
				);
			write(
				`${row}${pad(shown, 8)}${pad(String(minimum), 6)}${
					pass ? '✓ (reported)' : '· below ours, the theme’s choice'
				}`,
			);
		}
	}
}

write('');
write(
	`  informational pairs: ${declarations.length - gatedPairs.length} (reported, never gated${PRINT_ALL ? '' : '; --all to print them'})`,
);
if (hostBelow.length > 0) {
	write(
		`  host mode, below one of our minimums (${hostBelow.length}) — the fixture theme's own values:`,
	);
	for (const line of hostBelow) write(`    · ${line}`);
}
if (hostGaps.length > 0) {
	write(
		`  host mode, not resolvable against the fixture (${hostGaps.length}) — add the variable to HOST_FIXTURE:`,
	);
	for (const gap of hostGaps) write(`    · ${gap}`);
}
write('');

if (gatedFailed > 0 || unresolvedGated > 0) {
	fail(
		`  contrast: FAILED — ${gatedFailed} gated pair(s) below minimum, ${unresolvedGated} unresolved in light/dark`,
	);
	process.exit(1);
}
write(
	`  contrast: OK — all ${gatedChecks} gated checks pass (light, dark); ${hostGaps.length} host gap(s), ${hostBelow.length} host pair(s) below our minimums`,
);
write('');
