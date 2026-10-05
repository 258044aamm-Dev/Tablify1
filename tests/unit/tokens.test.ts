/**
 * `src/styles/tokens.css` is the contract every rule in the plugin spends, and until this suite existed the
 * only thing checking it was a screenshot. Five claims:
 *
 *   1. the three zones exist, and `index.css` imports them in cascade order;
 *   2. every semantic token resolves in all three modes (light, dark, host) — by **parsing**, not by
 *      injecting: a custom-property this test could only load by creating a `<style>` element, and the
 *      project's own `obsidianmd/no-forbidden-elements` rule refuses that in tests too. (jsdom was tried
 *      first — it does cascade custom properties per selector and does inherit them, but it does not
 *      substitute `var()`, so the alias half would have been a hand-written resolver either way.) The one
 *      thing a parse cannot see is the cascade itself, so that claim is made structurally, with its
 *      reasoning written out, instead of being asserted away;
 *   3. every token that resolves to a colour is redeclared in the host block, so "Follow my Obsidian theme"
 *      can never leave one surface painted from our palette;
 *   4. the reduced-motion block zeroes every duration token;
 *   5. the three numbers `docs/04` fixes hold (44 px tap target, 16 px inputs, 40 px medium row).
 *
 * Zone membership is read from the same `@identity / @semantic / @host` markers `scripts/contrast.ts` and
 * `scripts/css-gate.ts` read — but parsed here independently, so a marker rename fails this suite as well
 * instead of being agreed away in one place.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

const tokensCss = read('src/styles/tokens.css');
const indexCss = read('src/styles/index.css');

type Zone = 'identity' | 'semantic' | 'host';

/** Everything between each `@name begin` marker and its matching `@name end`. */
function zone(name: Zone): string {
	const parts: string[] = [];
	const endMarker = `@${name} end`;
	let from = tokensCss.indexOf(`@${name} begin`);
	while (from !== -1) {
		const to = tokensCss.indexOf(endMarker, from);
		if (to === -1) break;
		parts.push(tokensCss.slice(from, to));
		from = tokensCss.indexOf(`@${name} begin`, to);
	}
	return parts.join('\n');
}

/** Every rule body whose selector is exactly `selector`, within `source`. */
function blocks(source: string, selector: string): string[] {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

/** Prettier wraps a long value onto its own lines; a comparison against a written-out curve must not
 * depend on where the wrap fell, so whitespace is flattened and the padding inside a function's
 * parentheses is dropped. */
const flatten = (value: string): string =>
	value.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();

/** `--token: value` pairs from CSS text (or a list of rule bodies), comments removed, last one winning. */
function declarations(source: string | string[]): Map<string, string> {
	const out = new Map<string, string>();
	const text = Array.isArray(source) ? source.join('\n') : source;
	for (const piece of text.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
		const match = /(--[\w-]+)\s*:\s*([\s\S]+)/.exec(piece);
		if (match?.[1] !== undefined && match[2] !== undefined)
			out.set(match[1], flatten(match[2]));
	}
	return out;
}

/** A media block's body, by its `@media (...)` query. */
function mediaBlock(query: string): string {
	const at = tokensCss.indexOf(query);
	if (at === -1) return '';
	const open = tokensCss.indexOf('{', at);
	if (open === -1) return '';
	let depth = 0;
	for (let i = open; i < tokensCss.length; i += 1) {
		if (tokensCss[i] === '{') depth += 1;
		else if (tokensCss[i] === '}') {
			depth -= 1;
			if (depth === 0) return tokensCss.slice(open + 1, i);
		}
	}
	return '';
}

const identityZone = zone('identity');
const semanticZone = zone('semantic');
const hostZone = zone('host');

const semanticTokens = [...declarations(blocks(semanticZone, ':root')).keys()];
const hostTokens = new Set(declarations(blocks(hostZone, 'body.tablify-host-theme')).keys());

/** mode → every declaration in play, in cascade order (identity, then semantic, then the mode's overrides). */
const lightTokens = new Map([
	...declarations(blocks(identityZone, ':root')),
	...declarations(blocks(semanticZone, ':root')),
]);
const darkTokens = new Map([
	...lightTokens,
	...declarations(blocks(identityZone, ':root.theme-dark')),
]);
const hostModeTokens = new Map([
	...lightTokens,
	...declarations(blocks(hostZone, 'body.tablify-host-theme')),
]);

const COLOUR = /^#[0-9a-f]{3,8}$|^rgba?\(/i;

/** Follows `var()` aliases; `host: true` when the chain ends on a variable this file never declares. */
function resolve(
	tokens: Map<string, string>,
	name: string,
	depth = 0,
): { value: string; host: boolean } | null {
	if (depth > 12) return null;
	const value = tokens.get(name);
	if (value === undefined) return null;
	const alias = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(value);
	if (alias?.[1] === undefined) return { value, host: false };
	const followed = resolve(tokens, alias[1], depth + 1);
	if (followed !== null) return followed;
	if (alias[2] !== undefined) return { value: alias[2].trim(), host: false };
	return { value: alias[1], host: true };
}

describe('the zones and the cascade', () => {
	it('has all three zones, with a palette, a vocabulary and a host mapping', () => {
		expect(identityZone).toContain('--tablify-parchment');
		expect(identityZone).toContain('--tablify-opt-cyan');
		expect(semanticZone).toContain('--tablify-surface:');
		expect(hostZone).toContain('--background-primary');
		expect(semanticTokens.length).toBeGreaterThan(30);
		expect(hostTokens.size).toBeGreaterThan(20);
	});

	it('imports the three files in cascade order — tokens, brand, grid', () => {
		const order = [...indexCss.matchAll(/@import\s+'\.\/([\w-]+)\.css'/g)].map(
			(match) => match[1],
		);
		expect(order).toEqual(['tokens', 'brand', 'grid']);
	});

	it('scopes the host mapping to body, which is what makes it win without a specificity fight', () => {
		// A custom property is inherited from the *nearest* declaring ancestor, not from the most specific
		// selector: the grid's elements sit inside body, and body is nearer than :root. So the mapping must
		// be declared on `body` (once), and the dark palette must stay on `:root.theme-dark` (once each).
		expect(blocks(hostZone, 'body.tablify-host-theme')).toHaveLength(1);
		expect(blocks(identityZone, ':root.theme-dark')).toHaveLength(1);
		expect(hostZone).not.toContain(':root.theme-dark');
	});
});

describe('every semantic token resolves in all three modes', () => {
	it('resolves to a concrete value in light and dark, and to a value or a host variable in host mode', () => {
		const unresolved: string[] = [];
		for (const token of semanticTokens) {
			if (resolve(lightTokens, token) === null) unresolved.push(`${token} [light]`);
			if (resolve(darkTokens, token) === null) unresolved.push(`${token} [dark]`);
			if (resolve(hostModeTokens, token) === null) unresolved.push(`${token} [host]`);
		}
		expect(unresolved).toEqual([]);
	});

	it('leaves no colour token resolving through our own palette when the host theme is on', () => {
		const ours: string[] = [];
		for (const token of semanticTokens) {
			const light = resolve(lightTokens, token);
			if (light === null || !COLOUR.test(light.value)) continue;
			// It is a colour, so the host block owes a declaration for it…
			if (!hostTokens.has(token)) ours.push(`${token} is not redeclared in the host block`);
			// …and that declaration has to end on a host variable, not on one of our literals.
			const host = resolve(hostModeTokens, token);
			if (host !== null && !host.host)
				ours.push(`${token} still resolves to ${host.value} — ours, not the theme's`);
		}
		expect(ours).toEqual([]);
	});

	it('gives every surface, rule and text token a host variable to point at', () => {
		const surfaces = [
			'--tablify-surface',
			'--tablify-surface-raised',
			'--tablify-surface-sunken',
			'--tablify-line',
			'--tablify-line-strong',
			'--tablify-text',
			'--tablify-text-muted',
			'--tablify-text-faint',
			'--tablify-accent',
			'--tablify-accent-text',
			'--tablify-focus-ring',
		];
		for (const token of surfaces) {
			const host = resolve(hostModeTokens, token);
			expect(host?.host, token).toBe(true);
			expect(host?.value, token).toMatch(/^--/);
		}
	});

	it('dark mode changes the palette, not just one token', () => {
		const differing = semanticTokens.filter(
			(token) => resolve(lightTokens, token)?.value !== resolve(darkTokens, token)?.value,
		);
		expect(differing.length).toBeGreaterThan(20);
	});
});

describe('motion', () => {
	const reduced = mediaBlock('@media (prefers-reduced-motion: reduce)');

	it('zeroes every duration token when the user asks for reduced motion', () => {
		expect(reduced).not.toBe('');
		const zeroed = declarations(reduced);
		const durations = semanticTokens.filter((token) => token.startsWith('--tablify-dur-'));
		expect(durations.length).toBeGreaterThan(5);
		expect(durations.filter((token) => zeroed.get(token) !== '0ms')).toEqual([]);
	});

	it('keeps opacity and drops movement instead of dropping the transition', () => {
		const zeroed = declarations(reduced);
		expect(zeroed.get('--tablify-enter-scale')).toBe('1');
		expect(zeroed.get('--tablify-enter-scale-lg')).toBe('1');
	});

	it('uses the documented easing curves verbatim, and never a bare ease-in', () => {
		const easing = declarations(blocks(semanticZone, ':root'));
		expect(easing.get('--tablify-ease-out')).toBe('cubic-bezier(0.23, 1, 0.32, 1)');
		expect(easing.get('--tablify-ease-in-out')).toBe('cubic-bezier(0.77, 0, 0.175, 1)');
		expect(easing.get('--tablify-ease-drawer')).toBe('cubic-bezier(0.32, 0.72, 0, 1)');
		const offenders = [...easing.entries()].filter(
			([, value]) => /(^|\s)ease-in(\s|,|$)/.test(value) && !value.includes('ease-in-out'),
		);
		expect(offenders).toEqual([]);
	});
});

describe('the numbers docs/04 fixes', () => {
	it('keeps a 44 px tap target, 16 px inputs and a 40 px medium row', () => {
		const base = declarations(blocks(semanticZone, ':root'));
		const px = (token: string): number => parseFloat(base.get(token) ?? '');
		expect(px('--tablify-tap')).toBeGreaterThanOrEqual(44);
		expect(px('--tablify-input-fs')).toBeGreaterThanOrEqual(16);
		expect(px('--tablify-row-h-medium')).toBeGreaterThanOrEqual(40);
		expect(px('--tablify-header-h')).toBeGreaterThanOrEqual(px('--tablify-row-h-short'));
		// The live row height is an alias of the medium one, so it is resolved rather than parsed.
		expect(resolve(lightTokens, '--tablify-row-h')).toEqual({
			value: `${String(px('--tablify-row-h-medium'))}px`,
			host: false,
		});
	});
});
