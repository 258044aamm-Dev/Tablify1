/**
 * The provisional command algebra — R2 step 2's pure half.
 *
 * These are the promises the session (and, later, R3's operation model) builds on: a command never
 * mutates its input, untouched tables are shared by reference rather than rebuilt, every accepted
 * command comes back with the inverse that undoes it exactly, and a refusal is a value with a code
 * a caller can branch on. The session's own suite proves the wiring; this one proves the algebra.
 */
import { describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/core/database/commands';
import { parseDocument, serializeDocument } from '../../src/core/database/index';
import type { DatabaseDocument } from '../../src/core/database/index';

const TABLE_A = 'tbl_' + 'a'.repeat(26);
const TABLE_B = 'tbl_' + 'b'.repeat(26);
const F_TITLE = 'fld_' + 'c'.repeat(26);
const F_LINK = 'fld_' + 'd'.repeat(26);
const F_NUMBER = 'fld_' + 'e'.repeat(26);
const R_ONE = 'row_' + 'f'.repeat(26);
const R_TWO = 'row_' + 'g'.repeat(26);

function documentOf(text: string): DatabaseDocument {
	const result = parseDocument(text);
	if (!result.ok) {
		throw new Error(
			`the test document must parse: ${result.errors.map((error) => error.code).join(', ')}`,
		);
	}
	return result.document;
}

function sample(): DatabaseDocument {
	return documentOf(
		JSON.stringify({
			format: 'tablify',
			version: 1,
			databaseId: 'db_' + 'z'.repeat(26),
			name: 'Studio',
			tables: [
				{
					id: TABLE_A,
					name: 'Shoots',
					fields: [
						{ id: F_TITLE, name: 'Title', type: 'text' },
						{
							id: F_LINK,
							name: 'Client',
							type: 'link',
							targetTableId: TABLE_B,
							allowMultiple: false,
						},
						{ id: F_NUMBER, name: 'Count', type: 'number' },
					],
					rows: [{ id: R_ONE, cells: { [F_TITLE]: 'First' } }, { id: R_TWO }],
					views: [],
				},
				{
					id: TABLE_B,
					name: 'Clients',
					fields: [{ id: 'fld_' + 'h'.repeat(26), name: 'Name', type: 'text' }],
					rows: [
						{
							id: 'row_' + 'i'.repeat(26),
							cells: { ['fld_' + 'h'.repeat(26)]: 'Ada' },
						},
					],
					views: [],
				},
			],
		}),
	);
}

describe('the command algebra', () => {
	it('never mutates its input and shares the tables it does not touch', () => {
		const before = sample();
		const textBefore = serializeDocument(before);
		const result = applyCommand(before, {
			kind: 'set-cell',
			tableId: TABLE_A,
			rowId: R_TWO,
			fieldId: F_TITLE,
			value: 'Second',
		});
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(serializeDocument(before)).toBe(textBefore);
		expect(result.document.tables[1]).toBe(before.tables[1]);
		expect(result.document.tables[0]).not.toBe(before.tables[0]);
		expect(result.document.name).toBe(before.name);
	});

	it('inverts a sequence exactly, applied back to front', () => {
		const start = sample();
		const commands = [
			{ kind: 'set-document-name', name: 'Renamed' },
			{ kind: 'rename-table', tableId: TABLE_A, name: 'Productions' },
			{ kind: 'set-cell', tableId: TABLE_A, rowId: R_TWO, fieldId: F_NUMBER, value: 4.5 },
			{ kind: 'set-cell', tableId: TABLE_A, rowId: R_ONE, fieldId: F_TITLE, value: null },
		] as const;

		let current = start;
		const inverses = [];
		for (const command of commands) {
			const applied = applyCommand(current, command);
			expect(applied.ok, JSON.stringify(command)).toBe(true);
			if (!applied.ok) {
				return;
			}
			current = applied.document;
			inverses.unshift(applied.inverse);
		}
		expect(serializeDocument(current)).not.toBe(serializeDocument(start));
		for (const inverse of inverses) {
			const undone = applyCommand(current, inverse);
			expect(undone.ok).toBe(true);
			if (!undone.ok) {
				return;
			}
			current = undone.document;
		}
		expect(serializeDocument(current)).toBe(serializeDocument(start));
	});

	it('refuses with a code for every way a command can miss', () => {
		const document = sample();
		const cases = [
			[
				{ kind: 'rename-table', tableId: 'tbl_' + '9'.repeat(26), name: 'X' },
				'no-such-table',
			],
			[{ kind: 'rename-table', tableId: TABLE_A, name: '' }, 'invalid-name'],
			[{ kind: 'rename-table', tableId: TABLE_A, name: 'Shoots' }, 'no-change'],
			[{ kind: 'set-document-name', name: 'Studio' }, 'no-change'],
			[
				{
					kind: 'set-cell',
					tableId: TABLE_A,
					rowId: 'row_' + '9'.repeat(26),
					fieldId: F_TITLE,
					value: 'x',
				},
				'no-such-row',
			],
			[
				{
					kind: 'set-cell',
					tableId: TABLE_A,
					rowId: R_ONE,
					fieldId: 'fld_' + '9'.repeat(26),
					value: 'x',
				},
				'no-such-field',
			],
			[
				{
					kind: 'set-cell',
					tableId: TABLE_A,
					rowId: R_ONE,
					fieldId: F_NUMBER,
					value: 'five',
				},
				'cell-not-writable',
			],
			[
				{
					kind: 'set-cell',
					tableId: TABLE_A,
					rowId: R_ONE,
					fieldId: F_LINK,
					value: 'not-a-row-id',
				},
				'cell-not-writable',
			],
		] as const;
		for (const [command, code] of cases) {
			const result = applyCommand(document, command);
			expect(result.ok, JSON.stringify(command)).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe(code);
				expect(result.message.length).toBeGreaterThan(0);
			}
		}
	});

	it('setting a link to a well-shaped id is accepted, and the inverse clears it again', () => {
		const target = 'row_' + 'i'.repeat(26);
		const applied = applyCommand(sample(), {
			kind: 'set-cell',
			tableId: TABLE_A,
			rowId: R_TWO,
			fieldId: F_LINK,
			value: target,
		});
		expect(applied.ok).toBe(true);
		if (!applied.ok) {
			return;
		}
		expect(applied.document.tables[0]?.rows[1]?.cells.get(F_LINK)).toBe(target);
		expect(applied.inverse).toEqual({
			kind: 'set-cell',
			tableId: TABLE_A,
			rowId: R_TWO,
			fieldId: F_LINK,
			value: null,
		});
	});

	it('a preserved invalid value can be written back exactly as it was read', () => {
		// An invalid cell is what the reader hands over for a value it could not decode; the command
		// layer must be able to put that exact JSON back, or an undo of "repair this cell" would lose
		// the original spelling.
		const document = documentOf(
			JSON.stringify({
				format: 'tablify',
				version: 1,
				databaseId: 'db_' + 'z'.repeat(26),
				name: 'Studio',
				tables: [
					{
						id: TABLE_A,
						name: 'Shoots',
						fields: [{ id: F_NUMBER, name: 'Count', type: 'number' }],
						rows: [{ id: R_ONE, cells: { [F_NUMBER]: 'five' } }],
						views: [],
					},
				],
			}),
		);
		const previous = document.tables[0]?.rows[0]?.cells.get(F_NUMBER);
		expect(previous).toMatchObject({ invalid: true, raw: 'five' });
		const applied = applyCommand(document, {
			kind: 'set-cell',
			tableId: TABLE_A,
			rowId: R_ONE,
			fieldId: F_NUMBER,
			value: 5,
		});
		expect(applied.ok).toBe(true);
		if (!applied.ok) {
			return;
		}
		const undone = applyCommand(applied.document, applied.inverse);
		expect(undone.ok).toBe(true);
		if (!undone.ok) {
			return;
		}
		expect(serializeDocument(undone.document)).toBe(serializeDocument(document));
	});
});
