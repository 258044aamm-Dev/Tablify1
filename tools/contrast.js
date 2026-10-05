#!/usr/bin/env node
/* ============================================================================
   tools/contrast.js — contrast gate for the design tokens.

   Reads the `@contrast` declarations in prototype/css/tokens.css, resolves the
   tokens (following var() aliases), computes the WCAG 2.1 ratio for both the
   light and the dark palette, and exits non-zero if any gated pair is below its
   threshold.

     node tools/contrast.js                     # gate
     node tools/contrast.js --verbose           # + informational pairs

   No dependencies. Tokens are the only place colours are allowed to live, which
   is what makes this file possible at all.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const TOKENS = path.join(__dirname, '..', 'prototype', 'css', 'tokens.css');
const verbose = process.argv.includes('--verbose');

/* ── token extraction ─────────────────────────────────────────────────────── */
function blockFor(css, selector) {
	const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const hit = new RegExp(esc + '\\s*\\{').exec(css);
	if (!hit) return null;
	const open = hit.index + hit[0].length - 1;
	let depth = 0;
	for (let j = open; j < css.length; j++) {
		if (css[j] === '{') depth++;
		else if (css[j] === '}') {
			depth--;
			if (!depth) return css.slice(open + 1, j);
		}
	}
	return null;
}
function parseDecls(body) {
	const out = {};
	(body || '').split(';').forEach(function (line) {
		const m = line.replace(/\/\*[\s\S]*?\*\//g, '').match(/(--[\w-]+)\s*:\s*([^;]+)/);
		if (m) out[m[1]] = m[2].trim();
	});
	return out;
}
function resolve(tokens, name, depth) {
	depth = depth || 0;
	if (depth > 12) return null;
	let v = tokens[name];
	if (v == null) return null;
	const m = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/);
	if (m) return resolve(tokens, m[1], depth + 1) || (m[2] ? m[2].trim() : null);
	return v;
}

/* ── colour maths (WCAG 2.1) ──────────────────────────────────────────────── */
function parseColor(str) {
	if (!str) return null;
	const s = str.trim();
	let m = s.match(/^#([0-9a-f]{3})$/i);
	if (m) return [0, 1, 2].map((i) => parseInt(m[1][i] + m[1][i], 16));
	m = s.match(/^#([0-9a-f]{6})$/i);
	if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
	m = s.match(/^rgba?\(([^)]+)\)$/i);
	if (m) {
		const parts = m[1].split(/[,/]/).map((x) => parseFloat(x.trim()));
		if (parts.length >= 3)
			return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
	}
	return null;
}
function over(fg, bg) {
	/* composite a translucent colour */
	if (!fg) return null;
	if (Array.isArray(fg)) return fg;
	const a = fg.a == null ? 1 : fg.a;
	const b = Array.isArray(bg) ? bg : (bg && bg.rgb) || [255, 255, 255];
	return [0, 1, 2].map((i) => Math.round(fg.rgb[i] * a + b[i] * (1 - a)));
}
function luminance(rgb) {
	const c = rgb
		.map((v) => v / 255)
		.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
	return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
	const la = luminance(a),
		lb = luminance(b);
	const hi = Math.max(la, lb),
		lo = Math.min(la, lb);
	return (hi + 0.05) / (lo + 0.05);
}

/* ── run ──────────────────────────────────────────────────────────────────── */
const css = fs.readFileSync(TOKENS, 'utf8');
const light = parseDecls(blockFor(css, ':root') || '');
const dark = Object.assign({}, light, parseDecls(blockFor(css, ':root.theme-dark') || ''));
const host = parseDecls(blockFor(css, ':root[data-tablify-theme="host"]') || '');

const decls = [];
const re = /@contrast(-info)?\s+(--[\w-]+)\s+on\s+(--[\w-]+)(?:\s+min\s+([\d.]+))?/g;
let m;
while ((m = re.exec(css)))
	decls.push({ info: !!m[1], fg: m[2], bg: m[3], min: m[4] ? parseFloat(m[4]) : null });

let failed = 0,
	checked = 0;
const pairs = decls.map((d) => (d.fg + ' on ' + d.bg).length);
const W = Math.max.apply(null, pairs.concat([30])) + 3;
const pad = (s, n) => String(s).padEnd(n);
console.log('\n  Tablify contrast gate — ' + decls.length + ' declared pairs\n');
console.log('  ' + pad('pair', W) + pad('mode', 7) + pad('ratio', 8) + pad('min', 6) + 'result');
console.log('  ' + '─'.repeat(W + 21));

[
	['light', light],
	['dark', dark],
].forEach(function (mode) {
	decls.forEach(function (d) {
		const fgRaw = resolve(mode[1], d.fg);
		const bgRaw = resolve(mode[1], d.bg);
		const bg = parseColor(bgRaw) ? over(parseColor(bgRaw), [255, 255, 255]) : null;
		const fg = parseColor(fgRaw) ? over(parseColor(fgRaw), bg) : null;
		if (!fg || !bg) {
			console.log(
				'  ' +
					pad(d.fg + ' on ' + d.bg, W) +
					pad(mode[0], 7) +
					pad('—', 8) +
					pad(d.min || '—', 6) +
					'unresolved',
			);
			return;
		}
		const r = ratio(fg, bg);
		const isInfo = d.info || d.min == null;
		const pass = isInfo ? true : r >= d.min - 0.005;
		if (isInfo) {
			if (verbose)
				console.log(
					'  ' +
						pad(d.fg + ' on ' + d.bg, W) +
						pad(mode[0], 7) +
						pad(r.toFixed(2), 8) +
						pad('info', 6) +
						'·',
				);
			return;
		}
		checked++;
		if (!pass) failed++;
		console.log(
			'  ' +
				pad(d.fg + ' on ' + d.bg, W) +
				pad(mode[0], 7) +
				pad(r.toFixed(2), 8) +
				pad(d.min, 6) +
				(pass ? '✓' : '✗ FAILS'),
		);
	});
});

/* informational context: how far "follow my theme" moves the accent */
if (verbose && host['--tablify-accent']) {
	console.log(
		'\n  host mode declares --tablify-accent: ' +
			host['--tablify-accent'] +
			' (delegated to the theme)',
	);
}
console.log(
	'\n  ' +
		(failed
			? failed + ' of ' + checked + ' gated pairs FAIL'
			: 'all ' + checked + ' gated pairs pass') +
		'\n',
);
process.exit(failed ? 1 : 0);
