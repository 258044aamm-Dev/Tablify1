import { describe, expect, it } from 'vitest';

import { DEFAULT_CSV_OPTIONS, fromCsv, toCsv } from '../../src/core/export/csv';

describe('native CSV export', () => {
	it('quotes commas, quotes and line breaks, doubling inner quotes', () => {
		const text = toCsv([['plain', 'a,b', 'say "hi"', 'two\nlines']]);
		expect(text).toBe('plain,"a,b","say ""hi""","two\nlines"\r\n');
	});

	it('quotes formula-leading text, as the clipboard does, and stores it as text', () => {
		const text = toCsv([['=SUM(A1:A9)', '+1', '-2', '@cmd', '\tindent', 'safe']]);
		expect(text).toBe('"=SUM(A1:A9)","+1","-2","@cmd","\tindent",safe\r\n');
		expect(fromCsv(text)).toEqual([['=SUM(A1:A9)', '+1', '-2', '@cmd', '\tindent', 'safe']]);
	});

	it('writes CRLF by default and LF on request, with a terminator on every record', () => {
		const matrix = [
			['a', 'b'],
			['c', 'd'],
		];
		expect(toCsv(matrix)).toBe('a,b\r\nc,d\r\n');
		expect(toCsv(matrix, { newline: 'lf' })).toBe('a,b\nc,d\n');
		expect(DEFAULT_CSV_OPTIONS.newline).toBe('crlf');
	});

	it('writes an empty matrix as empty text, and one empty cell as a quoted empty field', () => {
		expect(toCsv([])).toBe('');
		expect(toCsv([['']])).toBe('""\r\n');
		expect(fromCsv('""\r\n')).toEqual([['']]);
	});

	it('keeps empty cells at the end of a row so the width survives', () => {
		const matrix = [
			['a', '', ''],
			['', 'b', ''],
		];
		expect(toCsv(matrix)).toBe('a,,\r\n,b,\r\n');
		expect(fromCsv(toCsv(matrix))).toEqual(matrix);
	});

	it('round-trips awkward cells through the reader without changing any of them', () => {
		const matrix = [
			['Name', 'Note', 'Amount'],
			['Ada, Countess', 'line one\r\nline two', '1,200.00'],
			['O"Brien', '', '€5'],
			['  spaced  ', '=1+1', 'ünïcødé ✓'],
		];
		expect(fromCsv(toCsv(matrix))).toEqual(matrix);
		expect(fromCsv(toCsv(matrix, { newline: 'lf' }))).toEqual(matrix);
	});

	it('reads LF, CRLF and CR endings, and does not invent a record after a trailing terminator', () => {
		expect(fromCsv('a,b\nc,d\n')).toEqual([
			['a', 'b'],
			['c', 'd'],
		]);
		expect(fromCsv('a,b\r\nc,d')).toEqual([
			['a', 'b'],
			['c', 'd'],
		]);
		expect(fromCsv('a\rb')).toEqual([['a'], ['b']]);
		expect(fromCsv('')).toEqual([]);
	});
});
