/**
 * The clipboard matrix: TSV and HTML, both directions.
 *
 * Two kinds of fixture live here. The **Sheets fixture is captured** — it is the real `text/html` payload
 * Google Sheets puts on the clipboard, published verbatim by the author of a 2025 article that inspected it
 * (`https://zenn.dev/kyoya0819/articles/76c0a3c5fc8002`), which is why it carries `<google-sheets-html-origin>`,
 * a `<style>` block whose content is commented out, a `<colgroup>`, and a cell whose text sits inside two
 * nested `<div>`s. The **Excel fixture is constructed from the documented shape** and marked ASSUMED: Excel
 * wraps a table in the `mso` namespaces with `class=xl65` cells, and this environment has no Excel to copy
 * from. `docs/07` §"What is deliberately not tested" already concedes that real clipboard payloads differ per
 * OS; the honest thing is to say which fixture is which.
 */
import { describe, expect, it } from 'vitest';
import {
	decodeEntities,
	fromHtml,
	fromTsv,
	toHtml,
	toTsv,
} from '../../src/core/selection/clipboard';
import type { Matrix } from '../../src/core/selection/clipboard';

/** Captured: Google Sheets, macOS, 2025. Verbatim from the article named in the file header. */
const SHEETS_HTML = `<google-sheets-html-origin>
<style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style>
<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1" data-sheets-baot="1">
    <colgroup>
        <col width="100"/>
        <col width="100"/>
        <col width="100"/>
    </colgroup>
    <tbody>
        <tr style="height:21px;">
            <td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">id</td>
            <td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">name</td>
            <td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">email</td>
        </tr>
        <tr style="height:21px;">
            <td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;text-align:right;">1</td>
            <td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">Bob</td>
            <td style="border-right:1px solid transparent;overflow:visible;padding:2px 0px 2px 0px;vertical-align:bottom;">
                <div style="white-space:nowrap;overflow:hidden;position:relative;width:196px;left:3px;">
                    <div style="float:left;">
                        bob@example.com
                    </div>
                </div>
            </td>
        </tr>
    </tbody>
</table>
</google-sheets-html-origin>`;

/** What the fixture above must read as. */
const SHEETS_MATRIX: Matrix = [
	['id', 'name', 'email'],
	['1', 'Bob', 'bob@example.com'],
];

/**
 * ASSUMED: constructed from the documented Excel clipboard shape (mso namespaces, a `<col>` with a width, a
 * conditional `<!--[if gte mso 9]>` comment, `class=xl65` cells, single-quoted attributes). No Excel was
 * available to copy from, so this is the shape the format documents rather than a capture.
 */
const EXCEL_HTML = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv=Content-Type content="text/html; charset=utf-8">
<meta name=ProgId content=Excel.Sheet>
<!--[if gte mso 9]><xml>
 <x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
  <x:Name>Sheet1</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
 </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head>
<body link=blue vlink=purple>
<table border=0 cellpadding=0 cellspacing=0 width=192 style='border-collapse:collapse;table-layout:fixed;width:144pt'>
 <col width=64 style='width:48pt'>
 <col width=64 span=2 style='width:48pt'>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl65 width=64 style='height:15.0pt;width:48pt'>Name</td>
  <td class=xl65 width=64 style='width:48pt'>Total</td>
  <td class=xl66 width=64 style='width:48pt'>&nbsp;</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl65 style='height:15.0pt'>Widening &amp; paving</td>
  <td class=xl67 align=right style='text-align:right'>1,250.00</td>
  <td class=xl65>=SUM(B2:B2)</td>
 </tr>
 <tr height=20 style='height:15.0pt'>
  <td height=20 class=xl65 style='height:15.0pt'>Bridge<br>survey</td>
  <td class=xl66>&nbsp;</td>
  <td class=xl66>&nbsp;</td>
 </tr>
</table>
</body>
</html>`;

/** ASSUMED, as above: what that payload must read as. */
const EXCEL_MATRIX: Matrix = [
	['Name', 'Total', ''],
	['Widening & paving', '1,250.00', '=SUM(B2:B2)'],
	['Bridge\nsurvey', '', ''],
];

/** The matrices the round-trip fixtures use. Every one of them must survive both directions exactly. */
const FIXTURES: readonly { readonly label: string; readonly matrix: Matrix }[] = [
	{ label: 'one cell', matrix: [['only']] },
	{ label: 'one cell, empty', matrix: [['']] },
	{
		label: 'a typical selection',
		matrix: [
			['Name', 'Status', 'Effort'],
			['Widening the road', 'Doing', '45'],
			['Bridge survey', 'Done', ''],
		],
	},
	{
		label: 'a row with trailing empty cells',
		matrix: [
			['a', '', 'c'],
			['', '', ''],
		],
	},
	{ label: 'a cell containing a tab', matrix: [['before\tafter', 'next']] },
	{ label: 'a cell containing a newline', matrix: [['line one\nline two', 'next']] },
	{ label: 'a cell containing a carriage return', matrix: [['cr\rhere']] },
	{ label: 'a quote at the start of a cell', matrix: [['"quoted"', 'plain']] },
	{ label: 'a quote in the middle of a cell', matrix: [['say "hi"', 'plain']] },
	{ label: 'a doubled quote', matrix: [['""', 'x']] },
	{ label: 'a cell that looks like a formula', matrix: [['=SUM(A1:A9)', '+1', '-1', '@user']] },
	{ label: 'unicode, an emoji and a non-breaking space', matrix: [['কাজ', '🚧', 'a\u00a0b']] },
	{ label: 'ragged rows', matrix: [['one'], ['one', 'two', 'three']] },
];

describe('TSV, out and back', () => {
	it(`round-trips all ${String(FIXTURES.length)} fixtures exactly`, () => {
		for (const fixture of FIXTURES) {
			expect(fromTsv(toTsv(fixture.matrix)), fixture.label).toEqual(fixture.matrix);
		}
	});

	it('writes rows with LF and no trailing newline, and quotes only what needs it', () => {
		expect(
			toTsv([
				['a', 'b'],
				['c', 'd'],
			]),
		).toBe('a\tb\nc\td');
		expect(toTsv([['a\tb']])).toBe('"a\tb"');
		expect(toTsv([['say "hi"']])).toBe('"say ""hi"""');
		expect(toTsv([['=1+1']])).toBe('"=1+1"');
		expect(toTsv([['plain']])).toBe('plain');
	});

	it('keeps a trailing empty cell, so a row keeps its width', () => {
		expect(toTsv([['a', '', '']])).toBe('a\t\t');
		expect(fromTsv('a\t\t')).toEqual([['a', '', '']]);
	});

	it('drops the empty row a trailing newline produces, once', () => {
		expect(fromTsv('a\tb\n')).toEqual([['a', 'b']]);
		expect(fromTsv('a\tb\r\n')).toEqual([['a', 'b']]);
		expect(fromTsv('a\tb\n\n')).toEqual([['a', 'b']]);
		expect(fromTsv('')).toEqual([]);
		expect(fromTsv('\n')).toEqual([]);
	});

	it('survives a quoted newline inside a cell, and a lone CR as a line ending', () => {
		expect(fromTsv('"one\ntwo"\tnext')).toEqual([['one\ntwo', 'next']]);
		expect(fromTsv('a\tb\rc\td')).toEqual([
			['a', 'b'],
			['c', 'd'],
		]);
	});

	it('never evaluates anything: a formula-shaped cell is stored as text', () => {
		expect(fromTsv('=SUM(A1:A9)\t"=SUM(A1:A9)"')).toEqual([['=SUM(A1:A9)', '=SUM(A1:A9)']]);
		expect(fromTsv('@user\t-1\t+1')).toEqual([['@user', '-1', '+1']]);
	});

	it('documents the one loss: a final row that is entirely empty and one cell wide', () => {
		// toTsv writes `a\\n` for it — indistinguishable from a trailing newline — so the reader drops it.
		expect(fromTsv(toTsv([['a'], ['']]))).toEqual([['a']]);
		// Wider than one column it is kept, because the line then ends in a tab rather than a newline.
		expect(
			fromTsv(
				toTsv([
					['a', 'b'],
					['', ''],
				]),
			),
		).toEqual([
			['a', 'b'],
			['', ''],
		]);
	});
});

describe('HTML, out and back', () => {
	it(`round-trips all ${String(FIXTURES.length)} fixtures exactly`, () => {
		for (const fixture of FIXTURES) {
			expect(fromHtml(toHtml(fixture.matrix)), fixture.label).toEqual(fixture.matrix);
		}
	});

	it('writes one table with escaped text, <br> for a newline and &nbsp; for a space', () => {
		const html = toHtml([['a & b', 'line\nbreak', 'two words']]);
		expect(html).toBe(
			'<table><tbody><tr><td>a&nbsp;&amp;&nbsp;b</td><td>line<br>break</td><td>two&nbsp;words</td></tr></tbody></table>',
		);
	});

	it('marks a formula-looking cell as text the way Excel documents it', () => {
		expect(toHtml([['=1+1']])).toContain('mso-number-format');
		expect(toHtml([['plain']])).not.toContain('mso-number-format');
	});

	it('reads the captured Google Sheets payload, nested divs and all', () => {
		expect(fromHtml(SHEETS_HTML)).toEqual(SHEETS_MATRIX);
	});

	it('reads the constructed Excel payload, attributes, conditional comment and all', () => {
		expect(fromHtml(EXCEL_HTML)).toEqual(EXCEL_MATRIX);
	});

	it('reads a table with no <tbody>, with <th> headers, and wrapped in <html><body>', () => {
		expect(
			fromHtml(
				'<html><body><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>',
			),
		).toEqual([
			['a', 'b'],
			['1', '2'],
		]);
	});

	it('reads a table whose rows are ragged, and keeps the ragged shape', () => {
		expect(
			fromHtml('<table><tr><td>one</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>'),
		).toEqual([['one'], ['a', 'b', 'c']]);
	});

	it('ignores styling, scripts, comments and anything before the table', () => {
		const noisy =
			'<meta charset="utf-8"><!-- a note --><style>td {color: red;}</style><script>alert(1)</script>' +
			'<p>Copy of the sheet</p><table><tr><td>kept</td></tr></table><p>after</p>';
		expect(fromHtml(noisy)).toEqual([['kept']]);
	});

	it('reads a nested table as part of its cell’s text, because skipping it would lose the cell', () => {
		expect(
			fromHtml(
				'<table><tr><td>outer</td></tr><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>',
			),
		).toEqual([['outer'], ['']]);
	});

	it('decodes named and numeric entities, and leaves an unknown one as written', () => {
		expect(decodeEntities('a &amp; b &lt;c&gt; &#65; &#x42; &nbsp;&rsquo; &bogus;')).toBe(
			'a & b <c> A B  \u2019 &bogus;',
		);
		expect(fromHtml('<table><tr><td>R&amp;D &#8212; &lt;done&gt;</td></tr></table>')).toEqual([
			['R&D \u2014 <done>'],
		]);
	});

	it('answers null when there is no table at all, rather than an empty matrix', () => {
		expect(fromHtml('')).toBeNull();
		expect(fromHtml('plain text only')).toBeNull();
		expect(fromHtml('<p>a paragraph</p>')).toBeNull();
		expect(fromHtml('<table></table>')).toBeNull();
	});

	it('documents the one loss: edge spaces are trimmed, because HTML cannot carry them', () => {
		expect(fromHtml(toHtml([['  padded  ']]))).toEqual([['padded']]);
		expect(fromHtml(toHtml([['in  the  middle']]))).toEqual([['in  the  middle']]);
	});
});
