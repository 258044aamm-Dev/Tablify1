/**
 * The native database import's **source preview boundary**.
 *
 * This composes the existing pure matrix reader and column inference without importing the note-oriented
 * `core/import/plan` or the legacy note wizard. A native preview knows what was read, how the header is treated,
 * what the columns look like, and which types the person overrode; it does not know a destination table, generate
 * database IDs, or plan writes. Destination-specific matching/collisions belong to the later native plan.
 *
 * Text sources reuse the existing TSV/HTML/CSV and clipboard readers. A format adapter (for example, an XLSX
 * worksheet reader) can pass its selected sheet as a `matrix` source; it does not need a second inference path.
 * This module deliberately does not parse workbook bytes or decide which worksheet to import.
 */
import { inferColumns, readSource } from '../../import/preview';
import type { ColumnInference, ImportSource, ReadSourceResult } from '../../import/preview';
import type { Matrix } from '../../selection/clipboard';
import type { FieldTypeId } from '../../types';

/** The exact source facts and the user's choices for one column, before a target table is selected. */
export type DatabaseImportColumnPreview = {
	readonly index: number;
	readonly name: string;
	/** The unchanged evidence-based result, retained even when a person overrides the chosen type. */
	readonly inference: ColumnInference;
	/** The type that a later native import plan should use: the override, or the inference. */
	readonly type: FieldTypeId;
	/** Whether the column is included when a later native import plan is built. */
	readonly included: boolean;
};

/** A successful source-only preview. No note destination or database mutation is represented here. */
export type DatabaseImportPreview = {
	readonly ok: true;
	readonly sourceName: string;
	readonly flavour: Extract<ReadSourceResult, { readonly ok: true }>['flavour'];
	readonly hasHeader: boolean;
	/** The whole parsed source, including the header row when `hasHeader` is true. */
	readonly matrix: Matrix;
	/** Rows after header handling; blank rows are preserved for the destination plan to account for explicitly. */
	readonly body: Matrix;
	readonly width: number;
	/** Exact source rows after header handling, not a note count or an estimate of writes. */
	readonly rowCount: number;
	readonly columns: readonly DatabaseImportColumnPreview[];
};

/** A source that could not be previewed, with the reader's honest reason. */
export type DatabaseImportPreviewFailure = {
	readonly ok: false;
	readonly sourceName: string;
	readonly reason: string;
};

export type DatabaseImportPreviewResult = DatabaseImportPreview | DatabaseImportPreviewFailure;

/** The header and per-column choices the source preview uses. */
export type DatabaseImportPreviewOptions = {
	readonly hasHeader: boolean;
	readonly overrides?: ReadonlyMap<number, FieldTypeId> | undefined;
	readonly excluded?: ReadonlySet<number> | undefined;
};

/**
 * Read and infer a source for the native-table import path.
 *
 * `ImportSource` is intentionally source-only (text or an already-read matrix). Folder/template/frontmatter,
 * vault-file collisions, and note-run progress are owned by the existing note importer and do not enter this API.
 */
export function previewDatabaseImport(
	source: ImportSource,
	options: DatabaseImportPreviewOptions,
): DatabaseImportPreviewResult {
	const read = readSource(source);
	if (!read.ok) {
		return { ok: false, sourceName: source.name, reason: read.reason };
	}

	const inferred = inferColumns(read.matrix, options.hasHeader);
	const overrides = options.overrides ?? new Map<number, FieldTypeId>();
	const excluded = options.excluded ?? new Set<number>();
	return {
		ok: true,
		sourceName: source.name,
		flavour: read.flavour,
		hasHeader: options.hasHeader,
		matrix: read.matrix,
		body: inferred.body,
		width: inferred.width,
		rowCount: inferred.body.length,
		columns: inferred.columns.map((column) => ({
			index: column.index,
			name: column.name,
			inference: column,
			type: overrides.get(column.index) ?? column.type,
			included: !excluded.has(column.index),
		})),
	};
}
