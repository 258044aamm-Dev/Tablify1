/**
 * The clipboard round-trip: **one adversarial matrix, both flavours, unchanged**.
 *
 * `tests/unit/clipboard.test.ts` (step 09) proves the formats against captured payloads from real applications —
 * a Google Sheets `text/html` blob and an Excel-shaped one. This file proves the *other* half, which is the one
 * step 22's copy/paste pair can actually get wrong: a matrix that contains every character the two formats treat
 * as structure, taken out and put back through our own writer and reader.
 *
 * The fixture is deliberately hostile, and each cell is there for a named reason:
 *
 *   | Cell | Why it is in the fixture |
 *   |---|---|
 *   | `a\tb` | a tab is the TSV column separator — the one character that cannot survive unquoted |
 *   | `line 1\nline 2` | a newline is the TSV row separator, and `<br>` in HTML |
 *   | `=SUM(A1:A2)` | a leading `=` makes a spreadsheet evaluate the cell: it must stay text, here and there |
 *   | `"quoted"` | a leading quote is TSV's own escape character |
 *   | `007` | a number stored as text — the value must not become the number `7` |
 *   | `🎉 party` | astral-plane Unicode: two UTF-16 units, one grapheme, and a surrogate pair in JSON |
 *   | empty, middle | an empty cell *between* two values, which is where a naive split loses a column |
 *   | empty, end of row | an empty cell at the end, which is where a naive `join` loses a column |
 *
 * **What this file does not assert** is that a spreadsheet will agree — `docs/07` §\"What is deliberately not
 * tested\" lists real clipboard payloads from real applications as a manual check, and `docs/manual-test-log.md`
 * carries it. What it asserts is the half we own: the matrix we put on the clipboard is the matrix we read back.
 */
import { describe, expect, it } from 'vitest';

import { fromHtml, fromTsv, toHtml, toTsv } from '../../src/core/selection/clipboard';
import type { Matrix } from '../../src/core/selection/clipboard';

/** The hostile block: every cell named in the header, in a shape that has a middle and a trailing empty. */
const HOSTILE: Matrix = [
	['plain', 'a\tb', 'line 1\nline 2'],
	['=SUM(A1:A2)', '"quoted"', '007'],
	['🎉 party', '', 'after the hole'],
	['trailing', 'cells', ''],
];

/** The same block, spelled as the two formats are read back: what `toHtml`/`fromHtml` must preserve exactly. */
const EXPECTED_HTML: Matrix = HOSTILE;

describe('TSV', () => {
	it('round-trips the hostile matrix unchanged', () => {
		expect(fromTsv(toTsv(HOSTILE))).toEqual(HOSTILE);
	});

	it('quotes the four cells that would otherwise change the shape of the block', () => {
		const text = toTsv(HOSTILE);
		// A tab, a newline, a quote and a formula lead are the four reasons to quote; `plain` and `007` are not.
		expect(text).toContain('"a\tb"');
		expect(text).toContain('"line 1\nline 2"');
		expect(text).toContain('""quoted""');
		expect(text).toContain('"=SUM(A1:A2)"');
		// `007` needs no quoting, and it is the value that proves a text column does not become a number.
		expect(text).toContain('\t007\n');
	});

	it('keeps the empty cell in the middle and the empty cell at the end', () => {
		const back = fromTsv(toTsv(HOSTILE));
		expect(back[2]?.[1]).toBe('');
		// The trailing empty is the cell a `join`/`split` pair loses; the width is the assertion.
		expect(back[3]).toHaveLength(3);
		expect(back[3]?.[2]).toBe('');
		// And the block's width survives in the text: four rows, no row shorter than three cells.
		expect(back.map((row) => row.length)).toEqual([3, 3, 3, 3]);
	});

	it('never turns a formula-shaped cell into a number or an error', () => {
		const back = fromTsv(toTsv([['=SUM(A1:A2)', '=1+1', '-2', '+3', '@a']]));
		expect(back[0]).toEqual(['=SUM(A1:A2)', '=1+1', '-2', '+3', '@a']);
	});

	it('keeps a text-shaped number as text', () => {
		expect(fromTsv(toTsv([['007']]))[0]?.[0]).toBe('007');
	});

	it('keeps astral-plane characters as one code point each way', () => {
		const back = fromTsv(toTsv([['🎉 party']]));
		expect(back[0]?.[0]).toBe('🎉 party');
		expect([...(back[0]?.[0] ?? '')].length).toBe(7);
	});
});

/**
 * `fromHtml` of the rendered block. The writer and the reader are both ours, so a `null` here is a failure of the
 * pair and not a case to skip past — the helper fails loudly and answers an empty matrix so the caller's own
 * assertions still run and print a diff.
 */
function readBackHtml(): Matrix {
	const back = fromHtml(toHtml(HOSTILE));
	expect(back, 'the HTML the writer produced must read back as a table').not.toBeNull();
	return back ?? [];
}

describe('HTML', () => {
	it('round-trips the hostile matrix unchanged', () => {
		expect(fromHtml(toHtml(HOSTILE))).toEqual(EXPECTED_HTML);
	});

	it('writes a real table, with the newline as <br> and the formula marked as text', () => {
		const html = toHtml(HOSTILE);
		expect(html).toContain('<table');
		// `<br>` rather than a newline inside `<td>`: HTML collapses whitespace, so a literal newline would read
		// back as a space and the cell would silently change. The spaces are `&nbsp;` for the same reason — an
		// ordinary space at the edge of a cell is trimmed by the HTML parser.
		expect(html).toContain('line&nbsp;1<br>line&nbsp;2');
		// The formula lead is marked the way Excel documents it rather than merely escaped.
		expect(html).toContain('mso-number-format');
	});

	it('keeps the empty cell in the middle and the empty cell at the end', () => {
		const back = readBackHtml();
		expect(back[2]?.[1]).toBe('');
		expect(back[3]?.[2]).toBe('');
		expect(back.map((row) => row.length)).toEqual([3, 3, 3, 3]);
	});

	it('keeps a tab inside a cell, which HTML would normally collapse', () => {
		// The reader takes a cell's `textContent` and does not normalise its whitespace, which is what makes this
		// work; if it ever started collapsing runs of whitespace, this is the assertion that would notice.
		expect(fromHtml(toHtml([['a\tb']]))?.[0]?.[0]).toBe('a\tb');
	});

	it('reads a table that carries the block as its only content, however it is wrapped', () => {
		const wrapped = `<html><body><table><tr><td>a</td><td>b</td></tr></table></body></html>`;
		expect(fromHtml(wrapped)).toEqual([['a', 'b']]);
	});

	it('answers null rather than an empty matrix when there is no table', () => {
		expect(fromHtml('<p>just a paragraph</p>')).toBeNull();
	});
});

describe('the two flavours agree', () => {
	it('produces the same matrix from the TSV and the HTML of the same block', () => {
		expect(fromHtml(toHtml(HOSTILE))).toEqual(fromTsv(toTsv(HOSTILE)));
	});
});
