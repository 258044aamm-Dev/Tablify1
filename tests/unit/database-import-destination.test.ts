/**
 * The native import's destination-choice contract. Plan construction will resolve IDs and verify confirmation;
 * these tests pin the choices without invoking the legacy note-import plan or a database mutation.
 */
import { describe, expect, it } from 'vitest';

import { requiresImportMappingConfirmation } from '../../src/core/database';
import type { DatabaseImportDestination, ImportFieldMapping } from '../../src/core/database';

describe('native database import destinations', () => {
	it('creates a named table in the current database without a note/vault destination', () => {
		const destination: DatabaseImportDestination = { kind: 'create', tableName: 'Projects' };

		expect(destination).toEqual({ kind: 'create', tableName: 'Projects' });
		expect(requiresImportMappingConfirmation(destination)).toBe(false);
		expect(destination).not.toHaveProperty('folder');
		expect(destination).not.toHaveProperty('template');
		expect(destination).not.toHaveProperty('path');
	});

	it('marks name-based append mapping as a suggestion that still needs confirmation', () => {
		const destination: DatabaseImportDestination = {
			kind: 'append',
			tableId: 'tbl_existing',
			fieldMapping: { kind: 'suggest-by-name' },
		};

		expect(requiresImportMappingConfirmation(destination)).toBe(true);
	});

	it('does not require name-match confirmation for an explicit stable-field-ID mapping', () => {
		const mapping: ImportFieldMapping = {
			kind: 'field-ids',
			fields: [
				{ sourceColumn: 0, fieldId: 'fld_name' },
				{ sourceColumn: 2, fieldId: 'fld_status' },
			],
		};
		const destination: DatabaseImportDestination = {
			kind: 'append',
			tableId: 'tbl_existing',
			fieldMapping: mapping,
		};

		expect(requiresImportMappingConfirmation(destination)).toBe(false);
		expect(mapping.fields.map((field) => [field.sourceColumn, field.fieldId])).toEqual([
			[0, 'fld_name'],
			[2, 'fld_status'],
		]);
	});

	it('keeps replace conservative: absent fields stay by default and row matching uses an explicit field ID', () => {
		const destination: DatabaseImportDestination = {
			kind: 'replace',
			tableId: 'tbl_existing',
			fieldMapping: { kind: 'suggest-by-name' },
			rowMatch: { kind: 'field-id', sourceColumn: 0, fieldId: 'fld_external_key' },
			removeAbsentFields: false,
		};

		expect(destination.removeAbsentFields).toBe(false);
		expect(destination.rowMatch).toEqual({
			kind: 'field-id',
			sourceColumn: 0,
			fieldId: 'fld_external_key',
		});
		expect(requiresImportMappingConfirmation(destination)).toBe(true);
	});

	it('represents no-key replace as append rather than matching rows by position', () => {
		const destination: DatabaseImportDestination = {
			kind: 'replace',
			tableId: 'tbl_existing',
			fieldMapping: { kind: 'field-ids', fields: [] },
			rowMatch: { kind: 'append' },
			removeAbsentFields: false,
		};

		expect(destination.rowMatch).toEqual({ kind: 'append' });
		expect(destination).not.toHaveProperty('positionMatch');
	});
});
