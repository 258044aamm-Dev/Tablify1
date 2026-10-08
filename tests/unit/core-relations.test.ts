/**
 * Relation integrity — R3 step 5.
 *
 * `validateLinks` remains the one document-wide scan. These tests pin the complementary write/cell
 * helpers to the same target-table and row-ownership rules, then exercise the actual operation paths
 * that use them. They also protect the non-destructive side of the contract: a loaded dangling id is
 * readable, visible as broken, and unchanged until a deliberate edit repairs it.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
	applyOperation,
	applyOperations,
	createIdFactory,
	inspectLinkCell,
	parseDocument,
	relationFindings,
	serializeDocument,
	validateLinks,
} from '../../src/core/database/index';
import type {
	CellState,
	DatabaseDocument,
	DatabaseTable,
	FieldDefinition,
	IdKind,
	OperationRefusalCode,
	OperationResult,
	OperationsResult,
} from '../../src/core/database/index';

/** Read one shipped fixture, so every identity below is derived from a parsed document. */
function fixtureText(name: string): string {
	return readFileSync(new URL(`../fixtures/tablify/${name}.tablify`, import.meta.url), 'utf8');
}

/** A fixture the document reader must accept. */
function fixture(name: string): DatabaseDocument {
	const loaded = parseDocument(fixtureText(name));
	if (!loaded.ok) {
		throw new Error(
			`expected ${name} to load; found ${loaded.errors.map((error) => error.code).join(', ')}`,
		);
	}
	return loaded.document;
}

/** Find a table by its visible label, failing with context when a fixture changes. */
function tableNamed(document: DatabaseDocument, name: string): DatabaseTable {
	const table = document.tables.find((candidate) => candidate.name === name);
	if (table === undefined) {
		throw new Error(`the fixture has no table named "${name}"`);
	}
	return table;
}

/** Find a supported link field by its visible label. */
function linkNamed(table: DatabaseTable, name: string): FieldDefinition {
	for (const field of table.fields) {
		if (field.kind === 'field' && field.type === 'link' && field.name === name) {
			return field;
		}
	}
	throw new Error(`the table "${table.name}" has no link named "${name}"`);
}

/** Find a supported text field by its visible label. */
function textNamed(table: DatabaseTable, name: string): FieldDefinition {
	for (const field of table.fields) {
		if (field.kind === 'field' && field.type === 'text' && field.name === name) {
			return field;
		}
	}
	throw new Error(`the table "${table.name}" has no text field named "${name}"`);
}

/** The first entry is needed only after the fixture itself has been checked. */
function first<T>(entries: readonly T[], label: string): T {
	const value = entries[0];
	if (value === undefined) {
		throw new Error(`the fixture has no ${label}`);
	}
	return value;
}

/** Generate unique, reproducible ids through the same injected factory used by the application. */
function ids(seed: number): (kind: IdKind) => string {
	let value = seed;
	return createIdFactory({
		randomValues(length) {
			const bytes = new Uint8Array(length);
			bytes.fill(value);
			value += 1;
			return bytes;
		},
	});
}

/** The unresolved row id already recorded by the dangling-reference fixture. */
function danglingRowId(): string {
	const document = fixture('dangling-refs');
	const table = tableNamed(document, 'Shoots');
	const field = linkNamed(table, 'Client');
	const row = first(table.rows, 'source row');
	const value = row.cells.get(field.id);
	if (typeof value !== 'string') {
		throw new Error('the dangling-reference fixture no longer carries its broken id');
	}
	return value;
}

/** Apply one operation or fail with the refusal that made the test impossible. */
function documentOf(result: OperationResult): DatabaseDocument {
	if (!result.ok) {
		throw new Error(`expected an operation to apply; it refused with ${result.code}`);
	}
	return result.document;
}

/** Assert a refusal without weakening the operation's typed result. */
function expectRefusal(
	result: OperationResult | OperationsResult,
	code: OperationRefusalCode,
): void {
	if (result.ok) {
		throw new Error(`expected refusal "${code}", but the operation applied`);
	}
	expect(result.code).toBe(code);
}

/** A new immutable document differing only in the named cell. */
function withCell(
	document: DatabaseDocument,
	tableId: string,
	rowId: string,
	fieldId: string,
	value: CellState,
): DatabaseDocument {
	const tables = document.tables.map((table) => {
		if (table.id !== tableId) {
			return table;
		}
		const rows = table.rows.map((row) => {
			if (row.id !== rowId) {
				return row;
			}
			const cells = new Map(row.cells);
			if (value === null) {
				cells.delete(fieldId);
			} else {
				cells.set(fieldId, value);
			}
			return { ...row, cells };
		});
		return { ...table, rows };
	});
	return { ...document, tables };
}

describe('pure relation findings', () => {
	it('checks target ownership, duplicates, cardinality and a missing target', () => {
		const document = fixture('rows-views');
		const source = tableNamed(document, 'Shoots');
		const target = tableNamed(document, 'Clients');
		const field = linkNamed(source, 'Client');
		const sourceRow = first(source.rows, 'source row');
		const targetRow = first(target.rows, 'target row');

		expect(relationFindings(document, field, targetRow.id)).toEqual([]);
		expect(
			relationFindings(document, field, sourceRow.id).map((finding) => finding.code),
		).toContain('foreign-row');
		expect(
			relationFindings(document, field, [targetRow.id, targetRow.id]).map(
				(finding) => finding.code,
			),
		).toContain('duplicate-reference');
		expect(
			relationFindings(document, field, [targetRow.id]).map((finding) => finding.code),
		).toContain('cardinality-mismatch');

		const broken = fixture('dangling-refs');
		const brokenSource = tableNamed(broken, 'Shoots');
		const missing = linkNamed(brokenSource, 'Client');
		const brokenCell = first(brokenSource.rows, 'dangling source row').cells.get(missing.id);
		expect(
			relationFindings(broken, missing, brokenCell).map((finding) => finding.code),
		).toContain('missing-row');
		const noTarget = linkNamed(brokenSource, 'Crew');
		const noTargetCell = first(brokenSource.rows, 'dangling source row').cells.get(noTarget.id);
		expect(
			relationFindings(broken, noTarget, noTargetCell).some(
				(finding) => finding.code === 'missing-target-table',
			),
		).toBe(true);
	});
});

describe('relation writes through database operations', () => {
	it('keeps set-link rules and guards direct link-cell edits without affecting text cells', () => {
		const document = fixture('rows-views');
		const source = tableNamed(document, 'Shoots');
		const target = tableNamed(document, 'Clients');
		const field = linkNamed(source, 'Client');
		const sourceRow = first(source.rows, 'source row');
		const targetRows = target.rows;
		const firstTarget = first(targetRows, 'target row');
		const secondTarget = first(targetRows.slice(1), 'second target row');
		const before = serializeDocument(document);

		const valid = applyOperation(document, {
			kind: 'set-link',
			tableId: source.id,
			rowId: sourceRow.id,
			fieldId: field.id,
			rowIds: [secondTarget.id],
		});
		expect(
			documentOf(valid)
				.tables.find((table) => table.id === source.id)
				?.rows[0]?.cells.get(field.id),
		).toBe(secondTarget.id);

		expectRefusal(
			applyOperation(document, {
				kind: 'set-link',
				tableId: source.id,
				rowId: sourceRow.id,
				fieldId: field.id,
				rowIds: [sourceRow.id],
			}),
			'unresolved-link',
		);
		expectRefusal(
			applyOperation(document, {
				kind: 'set-link',
				tableId: source.id,
				rowId: sourceRow.id,
				fieldId: field.id,
				rowIds: [danglingRowId()],
			}),
			'unresolved-link',
		);
		expectRefusal(
			applyOperation(document, {
				kind: 'set-link',
				tableId: source.id,
				rowId: sourceRow.id,
				fieldId: field.id,
				rowIds: [firstTarget.id, firstTarget.id],
			}),
			'unresolved-link',
		);
		expectRefusal(
			applyOperation(document, {
				kind: 'set-link',
				tableId: source.id,
				rowId: sourceRow.id,
				fieldId: field.id,
				rowIds: [firstTarget.id, secondTarget.id],
			}),
			'link-cardinality',
		);

		expectRefusal(
			applyOperation(document, {
				kind: 'set-cells',
				tableId: source.id,
				rowId: sourceRow.id,
				edits: [{ fieldId: field.id, value: sourceRow.id }],
			}),
			'unresolved-link',
		);
		expectRefusal(
			applyOperation(document, {
				kind: 'set-cells',
				tableId: source.id,
				rowId: sourceRow.id,
				edits: [{ fieldId: field.id, value: [firstTarget.id] }],
			}),
			'link-cardinality',
		);
		const generatedField = linkNamed(target, 'Shoots');
		expectRefusal(
			applyOperation(document, {
				kind: 'set-cells',
				tableId: target.id,
				rowId: firstTarget.id,
				edits: [{ fieldId: generatedField.id, value: sourceRow.id }],
			}),
			'generated-field',
		);

		const title = textNamed(source, 'Title');
		const textEdit = applyOperation(document, {
			kind: 'set-cells',
			tableId: source.id,
			rowId: sourceRow.id,
			edits: [{ fieldId: title.id, value: 'Still writable' }],
		});
		expect(
			documentOf(textEdit)
				.tables.find((table) => table.id === source.id)
				?.rows[0]?.cells.get(title.id),
		).toBe('Still writable');
		expect(serializeDocument(document)).toBe(before);
	});

	it('checks new field targets, row values and self-links before committing', () => {
		const document = fixture('rows-views');
		const source = tableNamed(document, 'Shoots');
		const target = tableNamed(document, 'Clients');
		const client = linkNamed(source, 'Client');
		const sourceRow = first(source.rows, 'source row');
		const nextId = ids(31);
		const missingField = linkNamed(tableNamed(fixture('dangling-refs'), 'Shoots'), 'Crew');
		const missingTargetId = missingField.settings.targetTableId;
		if (missingTargetId === undefined) {
			throw new Error('the dangling-reference fixture no longer names its missing table');
		}
		const before = serializeDocument(document);

		expectRefusal(
			applyOperation(document, {
				kind: 'create-field',
				tableId: source.id,
				fieldId: nextId('field'),
				name: 'Unresolved relation',
				type: 'link',
				settings: { targetTableId: missingTargetId },
			}),
			'unresolved-link',
		);
		expectRefusal(
			applyOperation(document, {
				kind: 'reconfigure-field',
				tableId: source.id,
				fieldId: client.id,
				settings: { ...client.settings, targetTableId: missingTargetId },
			}),
			'unresolved-link',
		);
		expectRefusal(
			applyOperation(document, {
				kind: 'reconfigure-field',
				tableId: source.id,
				fieldId: client.id,
				settings: { ...client.settings, targetTableId: source.id },
			}),
			'unresolved-link',
		);
		expectRefusal(
			applyOperation(document, {
				kind: 'reconfigure-field',
				tableId: source.id,
				fieldId: client.id,
				settings: { ...client.settings, allowMultiple: true },
			}),
			'link-cardinality',
		);
		const damaged = withCell(document, source.id, sourceRow.id, client.id, danglingRowId());
		expectRefusal(
			applyOperation(damaged, {
				kind: 'duplicate-record',
				tableId: source.id,
				rowId: sourceRow.id,
				newRowId: nextId('row'),
			}),
			'unresolved-link',
		);
		expectRefusal(
			applyOperation(document, {
				kind: 'create-record',
				tableId: source.id,
				rowId: nextId('row'),
				cells: [{ fieldId: client.id, value: danglingRowId() }],
			}),
			'unresolved-link',
		);

		const targetRow = first(target.rows, 'target row');
		const newRowId = nextId('row');
		const created = applyOperation(document, {
			kind: 'create-record',
			tableId: source.id,
			rowId: newRowId,
			cells: [{ fieldId: client.id, value: targetRow.id }],
		});
		expect(
			documentOf(created)
				.tables.find((table) => table.id === source.id)
				?.rows.at(-1)?.id,
		).toBe(newRowId);
		const selfFieldId = nextId('field');
		const withSelfField = documentOf(
			applyOperation(document, {
				kind: 'create-field',
				tableId: source.id,
				fieldId: selfFieldId,
				name: 'Self reference',
				type: 'link',
				settings: { targetTableId: source.id },
			}),
		);
		const selfRowId = nextId('row');
		const selfRow = applyOperation(withSelfField, {
			kind: 'create-record',
			tableId: source.id,
			rowId: selfRowId,
			cells: [{ fieldId: selfFieldId, value: selfRowId }],
		});
		expect(
			documentOf(selfRow)
				.tables.find((table) => table.id === source.id)
				?.rows.at(-1)
				?.cells.get(selfFieldId),
		).toBe(selfRowId);
		expect(serializeDocument(document)).toBe(before);
	});
});

describe('dangling links remain visible and lossless', () => {
	it('loads with a broken-reference state and round-trips the exact stored id', () => {
		const loaded = parseDocument(fixtureText('dangling-refs'));
		if (!loaded.ok) {
			throw new Error('the dangling-reference fixture must stay readable');
		}
		const source = tableNamed(loaded.document, 'Shoots');
		const field = linkNamed(source, 'Client');
		const row = first(source.rows, 'dangling source row');
		const originalValue = row.cells.get(field.id);
		if (typeof originalValue !== 'string') {
			throw new Error('the fixture must keep its link id as a readable value');
		}
		const inspection = inspectLinkCell(loaded.document, source.id, row.id, field.id);
		if (inspection === undefined) {
			throw new Error('the link cell must be inspectable');
		}
		expect(inspection.state).toBe('broken');
		expect(inspection.references[0]?.state).toBe('missing-row');
		expect(loaded.warnings.some((warning) => warning.code === 'unresolved-link')).toBe(true);

		const serialized = serializeDocument(loaded.document);
		expect(serialized).toContain(originalValue);
		const reloaded = parseDocument(serialized);
		if (!reloaded.ok) {
			throw new Error('serializing a broken relation must still produce a readable document');
		}
		const reloadedSource = tableNamed(reloaded.document, 'Shoots');
		const reloadedField = linkNamed(reloadedSource, 'Client');
		const reloadedRow = first(reloadedSource.rows, 'reloaded source row');
		expect(reloadedRow.cells.get(reloadedField.id)).toBe(originalValue);
		expect(serializeDocument(reloaded.document)).toBe(serialized);

		const malformed = fixture('invalid-values');
		const malformedTable = tableNamed(malformed, 'Bad values');
		const unreadableField = linkNamed(malformedTable, 'Other');
		const malformedRow = first(malformedTable.rows, 'malformed-value row');
		const unreadable = inspectLinkCell(
			malformed,
			malformedTable.id,
			malformedRow.id,
			unreadableField.id,
		);
		expect(unreadable?.state).toBe('unreadable');
		expect(unreadable?.findings.map((finding) => finding.code)).toContain('unreadable-value');
		const unreadableValue = malformedRow.cells.get(unreadableField.id);
		if (unreadableValue === undefined) {
			throw new Error('the malformed-value fixture no longer preserves its link payload');
		}
		expectRefusal(
			applyOperation(malformed, {
				kind: 'set-cells',
				tableId: malformedTable.id,
				rowId: malformedRow.id,
				edits: [{ fieldId: unreadableField.id, value: unreadableValue }],
			}),
			'unresolved-link',
		);
	});

	it('uses a restore-only inverse to undo a deliberate repair byte for byte', () => {
		const document = fixture('rows-views');
		const source = tableNamed(document, 'Shoots');
		const target = tableNamed(document, 'Clients');
		const field = linkNamed(source, 'Client');
		const row = first(source.rows, 'source row');
		const targetRow = first(target.rows, 'target row');
		const damaged = withCell(document, source.id, row.id, field.id, danglingRowId());
		const before = serializeDocument(damaged);
		const repair = applyOperation(damaged, {
			kind: 'set-link',
			tableId: source.id,
			rowId: row.id,
			fieldId: field.id,
			rowIds: [targetRow.id],
		});
		if (!repair.ok) {
			throw new Error(`the deliberate repair refused with ${repair.code}`);
		}
		const repaired = repair.document;
		expect(repair.inverses[0]?.kind).toBe('restore-cells');
		const undone = applyOperations(repaired, repair.inverses);
		if (!undone.ok) {
			throw new Error(`restoring the earlier dangling value refused with ${undone.code}`);
		}
		expect(serializeDocument(undone.document)).toBe(before);
	});

	it('restores a broken prior target configuration only through its inverse', () => {
		const document = fixture('dangling-refs');
		const source = tableNamed(document, 'Shoots');
		const target = tableNamed(document, 'Clients');
		const field = linkNamed(source, 'Crew');
		const row = first(source.rows, 'dangling source row');
		const before = serializeDocument(document);
		const cleared = applyOperation(document, {
			kind: 'set-cells',
			tableId: source.id,
			rowId: row.id,
			edits: [{ fieldId: field.id, value: null }],
		});
		if (!cleared.ok) {
			throw new Error(`clearing the broken value refused with ${cleared.code}`);
		}
		const configured = applyOperation(cleared.document, {
			kind: 'reconfigure-field',
			tableId: source.id,
			fieldId: field.id,
			settings: { ...field.settings, targetTableId: target.id },
		});
		if (!configured.ok) {
			throw new Error(`retargeting the empty field refused with ${configured.code}`);
		}
		expect(configured.inverses[0]?.kind).toBe('restore-field');

		const undoConfiguration = applyOperations(configured.document, configured.inverses);
		if (!undoConfiguration.ok) {
			throw new Error(
				`restoring the prior target configuration refused with ${undoConfiguration.code}`,
			);
		}
		expect(serializeDocument(undoConfiguration.document)).toBe(
			serializeDocument(cleared.document),
		);
		const undoClear = applyOperations(undoConfiguration.document, cleared.inverses);
		if (!undoClear.ok) {
			throw new Error(`restoring the broken cell refused with ${undoClear.code}`);
		}
		expect(serializeDocument(undoClear.document)).toBe(before);
	});
});

describe('cross-table deletion is atomic and order-preserving', () => {
	it('clears inbound links in one document change and restores their order on undo', () => {
		const document = fixture('rows-views');
		const source = tableNamed(document, 'Shoots');
		const target = tableNamed(document, 'Clients');
		const client = linkNamed(source, 'Client');
		const firstSourceRow = first(source.rows, 'source row');
		const targetRows = target.rows;
		const firstTarget = first(targetRows, 'target row');
		const secondTarget = first(targetRows.slice(1), 'second target row');
		const multiFieldId = ids(51)('field');
		const addedField = documentOf(
			applyOperation(document, {
				kind: 'create-field',
				tableId: source.id,
				fieldId: multiFieldId,
				name: 'Ordered relations',
				type: 'link',
				settings: { targetTableId: target.id, allowMultiple: true },
			}),
		);
		const beforeDelete = documentOf(
			applyOperation(addedField, {
				kind: 'set-cells',
				tableId: source.id,
				rowId: firstSourceRow.id,
				edits: [{ fieldId: multiFieldId, value: [secondTarget.id, firstTarget.id] }],
			}),
		);
		const beforeBytes = serializeDocument(beforeDelete);
		const deletion = applyOperation(beforeDelete, {
			kind: 'delete-record',
			tableId: target.id,
			rowId: firstTarget.id,
		});
		if (!deletion.ok) {
			throw new Error(`the cross-table delete refused with ${deletion.code}`);
		}
		const afterDelete = deletion.document;
		const sourceAfter = tableNamed(afterDelete, 'Shoots');
		const targetAfter = tableNamed(afterDelete, 'Clients');
		const firstSourceAfter = sourceAfter.rows.find(
			(candidate) => candidate.id === firstSourceRow.id,
		);
		expect(targetAfter.rows.map((candidate) => candidate.id)).toEqual([secondTarget.id]);
		expect(firstSourceAfter?.cells.get(multiFieldId)).toEqual([secondTarget.id]);
		expect(firstSourceAfter?.cells.has(client.id)).toBe(false);
		expect(validateLinks(afterDelete)).toEqual([]);

		const undone = applyOperations(afterDelete, deletion.inverses);
		if (!undone.ok) {
			throw new Error(`restoring cross-table references refused with ${undone.code}`);
		}
		expect(serializeDocument(undone.document)).toBe(beforeBytes);

		const ghost = danglingRowId();
		const failedBatch = applyOperations(beforeDelete, [
			{ kind: 'delete-record', tableId: target.id, rowId: firstTarget.id },
			{
				kind: 'set-cells',
				tableId: source.id,
				rowId: firstSourceRow.id,
				edits: [{ fieldId: multiFieldId, value: [ghost] }],
			},
		]);
		expectRefusal(failedBatch, 'unresolved-link');
		expect(serializeDocument(beforeDelete)).toBe(beforeBytes);
	});
});
