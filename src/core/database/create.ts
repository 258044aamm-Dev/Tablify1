/**
 * A brand-new database, built in memory — R2 step 3's rule: "new database creation writes a valid
 * minimum `.tablify` document before asking Obsidian to open it".
 *
 * The shape is the smallest document a person can use immediately: one table with one text field
 * and one empty row, and no saved views. Creating tables, fields and rows is R3's job — nothing
 * here goes beyond "a document that parses with zero warnings and shows a grid", and the ids are
 * injected so the caller decides where randomness comes from.
 */
import type { IdKind } from './ids';
import type { DatabaseDocument, DatabaseTable } from './schema';
import { DOCUMENT_VERSION, FORMAT_TAG } from './schema';

export interface CreateDocumentOptions {
	/** The database's display name. The file name is an address and is not stored here. */
	readonly name: string;
	/** The id source for every id the new document needs. */
	readonly ids: (kind: IdKind) => string;
}

/** Build a valid, empty database document. Pure: no clock, no randomness of its own, no host. */
export function createEmptyDocument(options: CreateDocumentOptions): DatabaseDocument {
	const { ids } = options;
	const table: DatabaseTable = {
		id: ids('table'),
		name: 'Table 1',
		fields: [
			{
				kind: 'field',
				id: ids('field'),
				name: 'Name',
				type: 'text',
				settings: {},
				unknown: [],
			},
		],
		rows: [
			{
				id: ids('row'),
				cells: new Map(),
				createdAt: null,
				updatedAt: null,
				unknown: [],
			},
		],
		views: [],
		unknown: [],
	};
	return {
		format: FORMAT_TAG,
		version: DOCUMENT_VERSION,
		databaseId: ids('database'),
		name: options.name,
		tables: [table],
		unknown: [],
	};
}
