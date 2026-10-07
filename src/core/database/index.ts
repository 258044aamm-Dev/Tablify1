/**
 * The native `.tablify` document core: one file, one multi-table database, no host.
 *
 * Public surface of `src/core/database/**`. Nothing here imports Obsidian, React, the DOM, a
 * filesystem or a clock — the boundary lint (`tests/unit/boundaries.test.ts`) proves that, and the
 * parser must stay runnable in a unit test with no host (docs/R1).
 */
export type { JsonObject, JsonValue, UnknownEntry } from './json';
export {
	isJsonArray,
	isJsonObject,
	parseJsonText,
	stringifyJson,
	toCanonicalObject,
	toJsonValue,
	unknownEntries,
} from './json';
export type { IdKind, IdSource } from './ids';
export {
	createIdFactory,
	findDuplicates,
	ID_BODY_LENGTH,
	ID_KINDS,
	ID_PREFIXES,
	idKindOf,
	isIdOfKind,
} from './ids';
export type {
	DurationUnit,
	FieldDefinition,
	FieldSettings,
	SelectOption,
	TableField,
	UnsupportedField,
} from './fields';
export { DURATION_UNITS, optionsOf, readFields, serializeField } from './fields';
export type { LinkFinding, LinkFindingCode } from './links';
export type { OptionFinding, OptionFindingCode } from './options';
export { validateOptions } from './options';
export { validateLinks } from './links';
export type { CommandRefusalCode, CommandResult, DocumentCommand } from './commands';
export { applyCommand } from './commands';
export type { CreateDocumentOptions } from './create';
export { createEmptyDocument } from './create';
export type { CellState, TableRow } from './rows';
export { readRows, serializeRow } from './rows';
export type { TableView, ViewDensity, ViewSort } from './views';
export { readViews, serializeView, VIEW_DENSITIES } from './views';
export type { DocumentLoad, LoadError, LoadWarning } from './result';
export type { DatabaseDocument, DatabaseTable, DocumentFieldTypeId } from './schema';
export {
	DOCUMENT_FIELD_TYPE_IDS,
	DOCUMENT_VERSION,
	FORMAT_TAG,
	isDocumentFieldTypeId,
	SUPPORTED_DOCUMENT_VERSIONS,
} from './schema';
export type { CanonicalCell, CellDecode, CellEncode, InvalidCell } from './values';
export { decodeCell, encodeCell, invalidCell, isInvalidCell } from './values';
export { parseDocument, readDocument, serializeDocument } from './envelope';
export type { CellRef, FieldRef, RowRef, TableRef, ViewRef } from './refs';
export { cellKey, cellRef, sameCell } from './refs';
export type { ActiveTableSnapshot, FieldComparison } from './projection';
export {
	canonicalComparison,
	cellOf,
	compareCanonical,
	displayOrder,
	fieldAt,
	projectTable,
	rowAt,
	rowNumber,
	sortRowIds,
	viewAt,
} from './projection';
export type { DocumentMigration, MigratedDocument } from './migrate';
export { DOCUMENT_MIGRATIONS, migrateDocument, parseAndMigrate } from './migrate';
