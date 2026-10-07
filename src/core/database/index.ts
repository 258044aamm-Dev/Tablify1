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
export type { DocumentLoad, LoadError, LoadWarning } from './result';
export type { DatabaseDocument, DatabaseTable } from './schema';
export { DOCUMENT_VERSION, FORMAT_TAG, SUPPORTED_DOCUMENT_VERSIONS } from './schema';
export { parseDocument, readDocument, serializeDocument } from './envelope';
