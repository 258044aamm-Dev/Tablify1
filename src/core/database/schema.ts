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

/** The literal discriminator at the top of every document. */
export const FORMAT_TAG = 'tablify';

/** The document schema version this build writes. */
export const DOCUMENT_VERSION = 1;

/** Every document schema version this build can load. Newer versions are refused, never migrated down. */
export const SUPPORTED_DOCUMENT_VERSIONS: readonly number[] = [DOCUMENT_VERSION];

/** One table: identity and display name, for now. Fields/rows/views arrive in steps 4–5. */
export interface DatabaseTable {
	readonly id: string;
	readonly name: string;
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
