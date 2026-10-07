/**
 * The version-1 `.tablify` document model — R1's frozen envelope.
 *
 * One file is one database. The shape here is deliberately small in this step: the envelope (R1
 * step 1) plus the minimal table identity (id and name; fields, rows and views are added by their
 * own steps, and until then they travel as preserved unknown entries like any other key this
 * version does not read yet). That is not a hole — it is the round-trip rule doing its job.
 *
 * Conventions fixed here, once:
 *
 *   - `format` is the literal `"tablify"`, so a random JSON file is never mistaken for a database.
 *   - `version` is the **document schema** version, not the plugin version. Only versions listed in
 *     {@link SUPPORTED_DOCUMENT_VERSIONS} load; a newer file is refused with its version named and
 *     is never rewritten or migrated down (R1 step 8).
 *   - `databaseId` is the identity of the logical database; renaming or moving the file never
 *     changes it, and no code path keys a database by path.
 *   - order that matters is written explicitly (tables now; fields, rows, options and views in
 *     their steps). Object-key order is never load-bearing.
 *   - every object carries the keys this version does not recognise as `unknown`, preserved in
 *     document order, so a file written by a newer build degrades without losing anything.
 */
import type { UnknownEntry } from './json';
import type { TableField } from './fields';
import type { TableRow } from './rows';
import type { TableView } from './views';
import type { FieldTypeId } from '../types';
import { FIELD_TYPE_IDS } from '../types';

/**
 * The field types a **document** can declare: the plugin's field types plus `link`.
 *
 * `link` is new here — linked records are R1 scope and have no predecessor in the frontmatter
 * model, whose `FieldTypeId` union has no relation type. Keeping the extension in one named alias
 * means steps 4–6 cannot accidentally accept a legacy-only id or forget the relation type.
 */
export type DocumentFieldTypeId = FieldTypeId | 'link';

/** Every document field type, for narrowing an untrusted name. Beside the union so they cannot drift. */
export const DOCUMENT_FIELD_TYPE_IDS: readonly DocumentFieldTypeId[] = [...FIELD_TYPE_IDS, 'link'];

/** True when `value` names a field type a document may declare. */
export function isDocumentFieldTypeId(value: string): value is DocumentFieldTypeId {
	return DOCUMENT_FIELD_TYPE_IDS.some((id) => id === value);
}

/** The literal discriminator at the top of every document. */
export const FORMAT_TAG = 'tablify';

/** The document schema version this build writes. */
export const DOCUMENT_VERSION = 1;

/** Every document schema version this build can load. Newer versions are refused, never migrated down. */
export const SUPPORTED_DOCUMENT_VERSIONS: readonly number[] = [DOCUMENT_VERSION];

/**
 * One table: identity, display name, its fields, its rows — in manual order, which *is* the
 * document order of the array (ADR-0003) — and its saved views.
 */
export interface DatabaseTable {
	readonly id: string;
	readonly name: string;
	readonly fields: readonly TableField[];
	readonly rows: readonly TableRow[];
	readonly views: readonly TableView[];
	readonly unknown: readonly UnknownEntry[];
}

/** A whole `.tablify` document in memory. */
export interface DatabaseDocument {
	readonly format: typeof FORMAT_TAG;
	readonly version: number;
	readonly databaseId: string;
	readonly name: string;
	readonly tables: readonly DatabaseTable[];
	readonly unknown: readonly UnknownEntry[];
}
