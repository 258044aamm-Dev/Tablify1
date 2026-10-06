/**
 * The export runner: **one read of the view, one serialisation, one destination.**
 *
 * Four decisions are in this file, and each is a sentence from the docs rather than a preference:
 *
 *  1. **CSV is not here.** `docs/01` §Export: *"CSV is already native in Bases; do not duplicate it"*. TSV for a
 *     spreadsheet and XLSX for typed data, nothing else — the dialog offers two formats and this refuses a third.
 *  2. **The table is read once.** `exportTable` walks the store's own order and values (`docs/07` §Tier 4's rule
 *     that an export's numbers are the view's numbers: *"Export reproduces the visible values"*), and every later
 *     step — the counts, the matrix, the typed cells, the undo-less write — works from that object. No cell is read
 *     twice, no note is opened at all, and **no note is written**: the only thing this file creates is the export
 *     file itself. The sole vault questions are `exists`/`createFolder`/`create` on the export's own path.
 *  3. **`selection` and `view` are the two scopes, and an empty selection is a refusal, not a fallback.** A person
 *     who asked for the selection and selected nothing gets a sentence; quietly exporting the whole view instead is
 *     the kind of helpfulness that ships 2,000 rows to a colleague.
 *  4. **Nothing is overwritten.** The name carries the moment (`Tablify export 2026-10-06 1432`) and a collision
 *     gets the product's own ` 2`/` 3` suffix, exactly the rule a note's name follows. The rule is *stated* twice
 *     and the implementation once: `core/import/naming.ts`'s `resolveCollision` is note-shaped (it always appends
 *     `.md`), so this file owns the eight-line version for the two spreadsheet extensions, with the same ceiling
 *     of 999 and the same wording. A core export module that took an extension would be the tidy version; it is a
 *     `src/core/**` change and this step was fenced to `src/core/export/**` — recorded in PROGRESS.md.
 *
 * The XLSX writer is a **dynamic import inside the one function that needs it** (`./xlsx.ts`), which is what keeps
 * its evaluation off the plugin's startup path; `README`-level numbers are in `PROGRESS.md` §step 24.
 */
import { countExport, toHtml, toMatrix, toTsv, toXlsxData } from '../../core/export/serialize';
import type { ExportMode, ExportTable } from '../../core/export/serialize';
import { fieldsOf, rowsOf } from '../../core/selection/range';
import { cellAt } from '../../grid/store/store';
import { selectField } from '../../grid/store/selectors';
import type { ClipboardWritePath } from '../../grid/clipboard/host';
import type { GridStore } from '../../grid/store/types';
import type { RowId } from '../../core/ops/types';
import type { CellValue, PropertyId } from '../../core/types';
import type { XlsxResult } from './xlsx';

/** What to export. Both halves of each pair are choices a person makes; none of them is inferred. */
export type ExportScope = 'selection' | 'view';
export type ExportFormat = 'tsv' | 'xlsx';
export type ExportDestination = 'clipboard' | 'file';

export type ExportRequest = {
	readonly scope: ExportScope;
	readonly format: ExportFormat;
	readonly destination: ExportDestination;
	readonly mode: ExportMode;
};

/** The vault-relative folder every export is written to. Documented here, because the docs do not name one. */
export const EXPORT_FOLDER = 'Tablify exports';

/** The name every export starts with, before the moment and the suffix. */
export const EXPORT_PREFIX = 'Tablify export';

/** Everything the runner touches outside itself. One object, so a test is a double and not a mock framework. */
export type ExportPorts = {
	readonly clipboard: {
		readonly write: (payload: {
			readonly tsv: string;
			readonly html: string;
		}) => Promise<ClipboardWritePath>;
	};
	readonly vault: {
		readonly exists: (path: string) => boolean;
		readonly createFolder: (path: string) => Promise<void>;
		/** Text for TSV, bytes for XLSX: the two shapes a vault writes. */
		readonly create: (path: string, file: string | ArrayBuffer) => Promise<void>;
	};
	readonly now: () => Date;
	/** Optional: the live region, a Notice, or both. The runner reports either way. */
	readonly announce?: ((message: string) => void) | undefined;
	/** Injected by the tests to make the writer fail; the real one is the dynamic import in `./xlsx.ts`. */
	readonly writeXlsx?:
		((rows: readonly (readonly unknown[])[], name: string) => Promise<XlsxResult>) | undefined;
};

export type ExportSummary = {
	readonly ok: boolean;
	/** What the person is told. Always a whole sentence, never a code. */
	readonly message: string;
	readonly rows: number;
	readonly columns: number;
	readonly bytes: number;
	/** The file written, or `null` for a clipboard export. */
	readonly path: string | null;
	/** Which clipboard path ran, or `null` for a file export. */
	readonly clipboardPath: ClipboardWritePath | null;
};

/**
 * The table an export will carry, read **once** from the store.
 *
 * Order is the view's own (`snapshot.order`), which is what makes an export of a filtered, sorted view the rows the
 * person is looking at. `selection` uses the same two axes the copy path uses; a missing selection is an empty
 * table, and an unresolved column is skipped rather than exported as a nameless column.
 */
export function exportTable(store: GridStore, scope: ExportScope): ExportTable {
	const snapshot = store.getSnapshot();
	const state = store.state();
	const order = snapshot.order;
	const rowIds: readonly RowId[] =
		scope === 'view'
			? order.rows
			: snapshot.selection === null
				? []
				: rowsOf(snapshot.selection, order);
	const fieldIds: readonly PropertyId[] =
		scope === 'view'
			? order.fields
			: snapshot.selection === null
				? []
				: fieldsOf(snapshot.selection, order);
	const fields = fieldIds
		.map((fieldId) => selectField(state, fieldId))
		.filter((field): field is NonNullable<typeof field> => field !== undefined);
	const rows = rowIds.map((filePath): readonly CellValue[] =>
		fieldIds.map((fieldId) => cellAt(state, filePath, fieldId)),
	);
	return { fields, rows };
}

/** `2026-10-06 1432` — local time, because the file is for the person who clicked export. */
export function stamp(date: Date): string {
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * The free path for one export: `Tablify exports/Tablify export 2026-10-06 1432.tsv`, and ` 2`, ` 3`… when the
 * vault already holds that name. The ceiling of 999 is `core/import/naming.ts`'s own, and `exists` is the only
 * vault question this runner asks more than once — it stops at the first free name.
 */
export function freePath(
	baseName: string,
	extension: string,
	exists: (path: string) => boolean,
): { readonly name: string; readonly path: string; readonly suffix: number } {
	for (let suffix = 0; suffix <= 999; suffix += 1) {
		const stem = suffix === 0 ? baseName : `${baseName} ${String(suffix + 1)}`;
		const name = `${stem}.${extension}`;
		const path = `${EXPORT_FOLDER}/${name}`;
		if (!exists(path)) {
			return { name, path, suffix };
		}
	}
	const name = `${baseName} 1001.${extension}`;
	return { name, path: `${EXPORT_FOLDER}/${name}`, suffix: 1001 };
}

/** What the fallback costs the message when the clipboard API was not the path that ran. */
function clipboardNote(path: ClipboardWritePath): string {
	return path === 'clipboard-api'
		? ''
		: ' (the copy used the legacy path: the clipboard API was not available)';
}

/** The refusal for a pair of choices that cannot be honoured, or `null` when they can. */
export function refusalFor(request: ExportRequest, table: ExportTable): string | null {
	if (table.fields.length === 0 || table.rows.length === 0) {
		return 'Nothing to export yet.';
	}
	if (request.format === 'xlsx' && request.destination === 'clipboard') {
		return 'An .xlsx is a file, not text — choose File, or export TSV to the clipboard.';
	}
	return null;
}

/**
 * Runs one export and answers with what happened.
 *
 * It never throws: a vault that refuses, a writer that fails and a pair of choices that cannot be honoured are all
 * answers, because the modal has to render them.
 */
export async function runExport(
	request: ExportRequest,
	table: ExportTable,
	ports: ExportPorts,
): Promise<ExportSummary> {
	const counts = countExport(table);
	const base = {
		rows: counts.rows,
		columns: counts.columns,
		path: null,
		clipboardPath: null,
	} as const;
	const refusal = refusalFor(request, table);
	if (refusal !== null) {
		return { ...base, ok: false, message: refusal, bytes: 0 };
	}

	const matrix = toMatrix(table, { mode: request.mode });
	const columns = table.fields.map((field) => ({
		name: field.definition.name,
		type: field.descriptor.id,
	}));

	if (request.destination === 'clipboard') {
		const tsv = toTsv(matrix);
		const path = await ports.clipboard.write({ tsv, html: toHtml(matrix) });
		const message =
			path === 'unavailable'
				? 'The clipboard is not available in this window — nothing was copied.'
				: `Exported ${String(counts.rows)} × ${String(counts.columns)} to the clipboard${clipboardNote(path)}.`;
		ports.announce?.(message);
		return {
			...base,
			ok: path !== 'unavailable',
			message,
			bytes: tsv.length,
			clipboardPath: path,
		};
	}

	const folder = EXPORT_FOLDER;
	const extension = request.format === 'xlsx' ? 'xlsx' : 'tsv';
	const baseName = `${EXPORT_PREFIX} ${stamp(ports.now())}`;
	const resolved = freePath(baseName, extension, (path) => ports.vault.exists(path));

	let bytes: string | ArrayBuffer;
	let size: number;
	if (request.format === 'xlsx') {
		try {
			const write = ports.writeXlsx ?? (await import('./xlsx')).writeXlsxSheet;
			const result = await write(toXlsxData(matrix, columns), resolved.name);
			bytes = result.bytes;
			size = result.bytes.byteLength;
		} catch (error) {
			const message = `The spreadsheet writer failed: ${error instanceof Error ? error.message : String(error)}`;
			ports.announce?.(message);
			return { ...base, ok: false, message, bytes: 0 };
		}
	} else {
		bytes = toTsv(matrix);
		size = bytes.length;
	}

	try {
		if (!ports.vault.exists(folder)) {
			await ports.vault.createFolder(folder);
		}
		await ports.vault.create(resolved.path, bytes);
	} catch (error) {
		const message = `The file could not be written: ${error instanceof Error ? error.message : String(error)}`;
		ports.announce?.(message);
		return { ...base, ok: false, message, bytes: 0 };
	}

	const message = `Exported ${String(counts.rows)} × ${String(counts.columns)} to “${resolved.path}”.`;
	ports.announce?.(message);
	return { ...base, ok: true, message, bytes: size, path: resolved.path };
}
