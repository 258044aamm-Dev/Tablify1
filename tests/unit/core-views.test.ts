/**
 * Saved views — R1 step 5's second gate.
 *
 * What is being proven, in the order the file proves it:
 *
 *   1. **A view is presentation, so nothing about it can fail a load for the wrong reason.** The
 *      list may be empty (a table whose only view was deleted is a state a UI can produce), and a
 *      view that is structurally unusable is refused *as a view* — the table still loads, with the
 *      remaining views and the errors named.
 *   2. **The stored filter document is preserved exactly and decoded beside it.** A node this build
 *      cannot read is a problem on the view (`filterProblems`) and a load warning — never a silent
 *      drop, because a newer build may understand it.
 *   3. **References are checked, never repaired.** A field id that names no column is kept and
 *      warned about; a field listed twice in one arrangement is kept and warned about.
 *   4. **Density and the frozen primary column are not stored in views**, and a file that carries
 *      them keeps them as unknown keys that round-trip verbatim.
 *
 * The last test pins the module to the shipped `rows-views` fixture, so the fixture and the reader
 * are proven against each other rather than each against a copy.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseDocument, serializeDocument } from '../../src/core/database/index';
import type { JsonValue, LoadError, LoadWarning, TableView } from '../../src/core/database/index';

const DATABASE_ID = 'db_' + 'z'.repeat(26);
const TABLE_ID = 'tbl_' + 'z'.repeat(26);
const F_TITLE = 'fld_' + 'a'.repeat(26);
const F_WHEN = 'fld_' + 'b'.repeat(26);
const F_STATUS = 'fld_' + 'c'.repeat(26);
const F_GHOST = 'fld_' + 'q'.repeat(26);
const V_ALL = 'viw_' + 'a'.repeat(26);
const OPT_A = 'opt_' + 'a'.repeat(26);

function fieldsJson(): JsonValue {
	return [
		{ id: F_TITLE, name: 'Title', type: 'text' },
		{ id: F_WHEN, name: 'When', type: 'date' },
		{ id: F_STATUS, name: 'Status', type: 'singleSelect', options: [{ id: OPT_A, name: 'A' }] },
	];
}

/** A view object with the identity keys filled in; `extra` carries the arrangement under test. */
function viewJson(extra: Record<string, JsonValue> = {}): JsonValue {
	return { id: V_ALL, name: 'All', ...extra };
}

/**
 * The document text for a test. A single view object is wrapped the way a table's views list
 * would hold it, so most tests can pass `viewJson({ … })` directly; list-level tests pass an
 * array (including an empty one).
 */
function documentText(views: JsonValue): string {
	const list = Array.isArray(views) ? views : [views];
	return JSON.stringify({
		format: 'tablify',
		version: 1,
		databaseId: DATABASE_ID,
		name: 'Test',
		tables: [{ id: TABLE_ID, name: 'Tasks', fields: fieldsJson(), rows: [], views: list }],
	});
}

function load(views: JsonValue): { readonly views: readonly TableView[]; readonly text: string } {
	const result = parseDocument(documentText(views));
	if (!result.ok) {
		throw new Error(
			`expected a load; got ${result.errors.map((error) => `${error.code} at ${error.path}`).join(', ')}`,
		);
	}
	return {
		views: result.document.tables[0]?.views ?? [],
		text: serializeDocument(result.document),
	};
}

function singleView(views: JsonValue): TableView {
	const loaded = load(views);
	if (loaded.views.length !== 1) {
		throw new Error(`expected exactly one view, got ${String(loaded.views.length)}`);
	}
	const view = loaded.views[0];
	if (view === undefined) {
		throw new Error('unreachable: length was checked');
	}
	return view;
}

function errorsOf(views: JsonValue): readonly LoadError[] {
	const result = parseDocument(documentText(views));
	if (result.ok) {
		throw new Error('the test expected a refusal, and the document parsed');
	}
	return result.errors;
}

function warningsOf(views: JsonValue): readonly LoadWarning[] {
	const result = parseDocument(documentText(views));
	if (!result.ok) {
		throw new Error('the test expected a load');
	}
	return result.warnings;
}

describe('the views list itself', () => {
	it('accepts an empty list — a table whose only view was deleted still loads', () => {
		const loaded = load([]);
		expect(loaded.views).toEqual([]);
	});

	it('requires the list, and refuses one that is not an array', () => {
		const table: Record<string, JsonValue> = {
			id: TABLE_ID,
			name: 'Tasks',
			fields: fieldsJson(),
			rows: [],
		};
		const base = {
			format: 'tablify',
			version: 1,
			databaseId: DATABASE_ID,
			name: 'Test',
		};
		const missing = parseDocument(JSON.stringify({ ...base, tables: [table] }));
		expect(missing.ok).toBe(false);
		if (!missing.ok) {
			expect(missing.errors.map((error) => error.code)).toEqual(['missing-views']);
		}
		const notArray = parseDocument(
			JSON.stringify({ ...base, tables: [{ ...table, views: 'none' }] }),
		);
		expect(notArray.ok).toBe(false);
		if (!notArray.ok) {
			expect(notArray.errors).toEqual([
				expect.objectContaining({ code: 'invalid-views', path: '$.tables[0].views' }),
			]);
		}
	});
});

describe('view identity', () => {
	it('refuses a view whose id is not shaped like one, and one with an empty name', () => {
		expect(errorsOf([{ id: 'All', name: 'All' }])).toEqual([
			expect.objectContaining({ code: 'invalid-view-id', path: '$.tables[0].views[0].id' }),
		]);
		expect(errorsOf([{ id: V_ALL, name: '' }])).toEqual([
			expect.objectContaining({
				code: 'invalid-view-name',
				path: '$.tables[0].views[0].name',
			}),
		]);
	});

	it('refuses a repeated view id, naming both positions', () => {
		const errors = errorsOf([viewJson({ name: 'First' }), viewJson({ name: 'Second' })]);
		expect(errors.map((error) => error.code)).toEqual(['duplicate-view-id']);
		expect(errors[0]?.message).toContain('views[0] and views[1]');
	});
});

describe('filters', () => {
	it('decodes a stored filter and keeps the raw document beside it', () => {
		const filter = { version: 1, expr: { kind: 'empty', fieldId: F_WHEN } };
		const view = singleView(viewJson({ filter }));
		expect(view.filter).toEqual(filter);
		expect(view.filterExpr).toEqual({ kind: 'empty', fieldId: F_WHEN });
		expect(view.filterProblems).toEqual([]);
		expect(warningsOf(viewJson({ filter }))).toEqual([]);
	});

	it('keeps a node it cannot read, reports the problem, and still writes the raw filter back', () => {
		const filter = { version: 1, expr: { kind: 'within', fieldId: F_WHEN, days: 7 } };
		const loaded = load(viewJson({ filter }));
		const view = loaded.views[0];
		expect(view?.filterProblems).toEqual(['query has an unknown kind']);
		expect(view?.filterExpr).toBeNull();
		expect(loaded.text).toContain('"kind": "within"');
		const warnings = warningsOf(viewJson({ filter }));
		expect(warnings).toEqual([
			expect.objectContaining({
				code: 'view-filter-problem',
				path: '$.tables[0].views[0].filter',
			}),
		]);
	});

	it('treats an explicit null like no filter at all, and omits it on write', () => {
		const loaded = load(viewJson({ filter: null }));
		const view = loaded.views[0];
		expect(view?.filter).toBeNull();
		expect(view?.filterExpr).toBeNull();
		expect(loaded.text).not.toContain('"filter"');
	});

	it('refuses a filter that is not a stored query object', () => {
		expect(errorsOf([viewJson({ filter: 'recent' })])).toEqual([
			expect.objectContaining({
				code: 'invalid-view-filter',
				path: '$.tables[0].views[0].filter',
			}),
		]);
	});

	it('keeps and warns about a filter that names a field the table does not have', () => {
		const filter = { version: 1, expr: { kind: 'empty', fieldId: F_GHOST } };
		const view = singleView(viewJson({ filter }));
		expect(view.filter).toEqual(filter);
		expect(view.filterExpr).toEqual({ kind: 'empty', fieldId: F_GHOST });
		expect(warningsOf(viewJson({ filter }))).toEqual([
			expect.objectContaining({
				code: 'view-unknown-field',
				path: '$.tables[0].views[0].filter',
			}),
		]);
	});
});

describe('the sort stack', () => {
	it('reads asc and desc, and preserves keys a sort entry does not own', () => {
		const loaded = load(
			viewJson({
				sorts: [
					{ fieldId: F_WHEN, direction: 'desc', tone: 'warm' },
					{ fieldId: F_TITLE, direction: 'asc' },
				],
			}),
		);
		const view = loaded.views[0];
		expect(view?.sorts).toEqual([
			{ fieldId: F_WHEN, direction: 'desc', unknown: [{ key: 'tone', value: 'warm' }] },
			{ fieldId: F_TITLE, direction: 'asc', unknown: [] },
		]);
		expect(loaded.text).toContain('"tone": "warm"');
	});

	it('refuses a direction the pipeline does not know, and drops the stack rather than guessing', () => {
		const errors = errorsOf(viewJson({ sorts: [{ fieldId: F_WHEN, direction: 'up' }] }));
		expect(errors.map((error) => error.code)).toEqual(['invalid-view-sort']);
		expect(errors[0]?.path).toBe('$.tables[0].views[0].sorts[0]');
	});

	it('keeps and warns about a sort that names a field the table does not have', () => {
		const view = singleView(viewJson({ sorts: [{ fieldId: F_GHOST, direction: 'asc' }] }));
		expect(view.sorts[0]?.fieldId).toBe(F_GHOST);
		expect(warningsOf(viewJson({ sorts: [{ fieldId: F_GHOST, direction: 'asc' }] }))).toEqual([
			expect.objectContaining({
				code: 'view-unknown-field',
				path: '$.tables[0].views[0].sorts[0].fieldId',
			}),
		]);
	});

	it('warns about the same field listed twice in one arrangement', () => {
		const warnings = warningsOf(
			viewJson({
				sorts: [
					{ fieldId: F_WHEN, direction: 'asc' },
					{ fieldId: F_WHEN, direction: 'desc' },
				],
			}),
		);
		expect(warnings).toEqual([
			expect.objectContaining({
				code: 'view-duplicate-field',
				path: '$.tables[0].views[0].sorts',
			}),
		]);
		expect(warnings[0]?.message).toContain('sort stack');
	});
});

describe('grouping and columns', () => {
	it('reads a groupBy, and warns when it names a field the table does not have', () => {
		expect(singleView(viewJson({ groupBy: F_STATUS })).groupBy).toBe(F_STATUS);
		expect(warningsOf(viewJson({ groupBy: F_GHOST }))).toEqual([
			expect.objectContaining({
				code: 'view-unknown-field',
				path: '$.tables[0].views[0].groupBy',
			}),
		]);
	});

	it('refuses a groupBy that is not a field id', () => {
		expect(errorsOf(viewJson({ groupBy: 3 }))).toEqual([
			expect.objectContaining({
				code: 'invalid-view-group',
				path: '$.tables[0].views[0].groupBy',
			}),
		]);
	});

	it('keeps the hidden and ordered column lists, warning about duplicates', () => {
		const view = singleView(
			viewJson({ hiddenFieldIds: [F_GHOST], columnOrder: [F_TITLE, F_TITLE] }),
		);
		expect(view.hiddenFieldIds).toEqual([F_GHOST]);
		expect(view.columnOrder).toEqual([F_TITLE, F_TITLE]);
		const warnings = warningsOf(
			viewJson({ hiddenFieldIds: [F_GHOST], columnOrder: [F_TITLE, F_TITLE] }),
		);
		expect(warnings.map((warning) => warning.code)).toEqual([
			'view-unknown-field',
			'view-duplicate-field',
		]);
	});

	it('refuses a column list with an entry that is not a field id, keeping the view', () => {
		const errors = errorsOf(viewJson({ hiddenFieldIds: [F_TITLE, 7] }));
		expect(errors).toEqual([
			expect.objectContaining({
				code: 'invalid-view-fields',
				path: '$.tables[0].views[0].hiddenFieldIds',
			}),
		]);
	});

	it('refuses collapsed keys that are not strings', () => {
		const errors = errorsOf(viewJson({ collapsedKeys: [F_STATUS, 7] }));
		expect(errors.map((error) => error.code)).toEqual(['invalid-view-collapsed']);
		const loaded = load(viewJson({ collapsedKeys: ['Group 1', 'Group 2'] }));
		expect(loaded.views[0]?.collapsedKeys).toEqual(['Group 1', 'Group 2']);
	});
});

describe('widths', () => {
	it('reads positive numbers and refuses zero, negatives and non-numbers entry by entry', () => {
		const errors = errorsOf(viewJson({ widths: { [F_TITLE]: 0, [F_WHEN]: 'wide' } }));
		expect(errors.map((error) => error.code)).toEqual([
			'invalid-view-width',
			'invalid-view-width',
		]);
		expect(errors[0]?.path).toBe(`$.tables[0].views[0].widths.${F_TITLE}`);
		expect(singleView(viewJson({ widths: { [F_TITLE]: 220 } })).widths.get(F_TITLE)).toBe(220);
	});

	it('refuses a widths value that is not an object', () => {
		expect(errorsOf(viewJson({ widths: [220] }))).toEqual([
			expect.objectContaining({
				code: 'invalid-view-widths',
				path: '$.tables[0].views[0].widths',
			}),
		]);
	});

	it('keeps and warns about a width whose field the table does not have', () => {
		const view = singleView(viewJson({ widths: { [F_GHOST]: 90 } }));
		expect(view.widths.get(F_GHOST)).toBe(90);
		expect(warningsOf(viewJson({ widths: { [F_GHOST]: 90 } }))).toEqual([
			expect.objectContaining({
				code: 'view-unknown-field',
				path: `$.tables[0].views[0].widths.${F_GHOST}`,
			}),
		]);
	});

	it('writes widths in field order first, then widths whose field the table lacks', () => {
		const loaded = load(
			viewJson({ widths: { [F_STATUS]: 100, [F_TITLE]: 200, [F_GHOST]: 50 } }),
		);
		const widthsAt = loaded.text.indexOf('"widths"');
		const slice = loaded.text.slice(widthsAt);
		const indexes = [F_TITLE, F_STATUS, F_GHOST].map((fieldId) =>
			slice.indexOf(`"${fieldId}"`),
		);
		expect(indexes.every((index) => index > -1)).toBe(true);
		expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
	});
});

describe('what a view does not store', () => {
	it('keeps density and frozenPrimary as unknown keys, and round-trips them verbatim', () => {
		const loaded = load(viewJson({ density: 'compact', frozenPrimary: true }));
		const view = loaded.views[0];
		expect(view).toBeDefined();
		if (view === undefined) {
			return;
		}
		expect(Object.keys(view)).not.toContain('density');
		expect(Object.keys(view)).not.toContain('frozenPrimary');
		expect(view.unknown).toEqual([
			{ key: 'density', value: 'compact' },
			{ key: 'frozenPrimary', value: true },
		]);
		expect(loaded.text).toContain('"density": "compact"');
		expect(loaded.text).toContain('"frozenPrimary": true');
	});
});

describe('the shipped fixture', () => {
	const FIXTURE = new URL('../fixtures/tablify/rows-views.tablify', import.meta.url);

	it('reads the two shipped views faithfully', () => {
		const result = parseDocument(readFileSync(FIXTURE, 'utf8'));
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.warnings).toEqual([]);
		const views = result.document.tables[0]?.views ?? [];
		expect(views.map((view) => view.name)).toEqual(['All', 'Unscheduled']);

		const all = views[0];
		expect(all?.filter).toBeNull();
		expect(all?.filterExpr).toBeNull();
		expect(all?.sorts).toEqual([
			{
				fieldId: 'fld_shootdate0000000000000000h',
				direction: 'asc',
				unknown: [],
			},
		]);
		expect(all?.widths.get('fld_title00000000000000000000c')).toBe(220);
		expect(all?.widths.get('fld_status0000000000000000000d')).toBe(120);
		expect(all?.columnOrder).toEqual([
			'fld_title00000000000000000000c',
			'fld_status0000000000000000000d',
			'fld_client0000000000000000000e',
		]);

		const unscheduled = views[1];
		expect(unscheduled?.filter).toEqual({
			version: 1,
			expr: { kind: 'empty', fieldId: 'fld_shootdate0000000000000000h' },
		});
		expect(unscheduled?.filterExpr).toEqual({
			kind: 'empty',
			fieldId: 'fld_shootdate0000000000000000h',
		});
		expect(unscheduled?.filterProblems).toEqual([]);
		expect(unscheduled?.groupBy).toBe('fld_status0000000000000000000d');
		expect(unscheduled?.hiddenFieldIds).toEqual(['fld_notes00000000000000000000k']);
		expect(unscheduled?.collapsedKeys).toEqual([]);
	});
});
