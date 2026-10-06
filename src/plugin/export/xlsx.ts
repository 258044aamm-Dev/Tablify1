/**
 * The one place the XLSX library is touched: **a dynamic import**, so the writer's ~73 KB is not evaluated unless
 * somebody actually exports a spreadsheet (the reason `docs/08` §E9 and §the risk register ask for it, and the
 * reason the dialog says *XLSX* before the import happens).
 *
 * What a dynamic import does and does not buy in this build, measured rather than assumed: Obsidian loads one
 * CommonJS `main.js`, esbuild cannot code-split CJS output, so the writer's code is **in** `main.js` either way
 * (+73.1 KB raw / +20.3 KB gzip, measured against the same build without the import) and only its *evaluation*
 * is deferred — no top-level work at plugin load, no fflate initialisation, no shared strings table. The numbers
 * are in `PROGRESS.md` §step 24 and the budget consequence is stated there too. An ESM build with code splitting
 * is not an option: Obsidian's plugin loader takes `main.js`, not a folder of chunks.
 *
 * `write-excel-file/browser` rather than the bare specifier: the package's `exports` map has no `"."` entry, and
 * `/browser` is the entry that hands back a `Blob` instead of writing to a filesystem — which is exactly what a
 * vault (or a download) needs, and it means this module never sees an `fs` import it cannot use.
 */
import type { XlsxRow } from '../../core/export/serialize';

/** The workbook writer, as the export path needs it: bytes and the name they should be written under. */
export type XlsxResult = {
	readonly bytes: ArrayBuffer;
	readonly name: string;
	/** The diagnostic every export path reports: which writer produced the bytes, and its resolved version. */
	readonly writer: string;
};

/** The sheet name in the workbook. One sheet, named after the plugin — a second sheet would be a second product. */
export const SHEET_NAME = 'Tablify';

/**
 * Writes one sheet and answers with its bytes.
 *
 * `toBlob()` and then `arrayBuffer()`, rather than the library's own `toFile()`: `toFile` triggers a browser
 * download, and an export that lands in the vault must not also land in the Downloads folder. The two calls are
 * the library's own API (`browser/ReturnType.d.ts`: `{ toBlob, toFile }`).
 */
export async function writeXlsxSheet(rows: readonly XlsxRow[], name: string): Promise<XlsxResult> {
	const module = await import('write-excel-file/browser');
	// The library's own `SheetData` is mutable (`Row[]`, `Cell[]`) while this build's serialiser answers with
	// `readonly` arrays, so the sheet is copied once, at the edge. One shallow copy of a few hundred rows is not
	// worth threading a mutable type through the pure core for.
	const sheet = rows.map((row) => [...row]);
	const blob = await module.default(sheet, { sheet: SHEET_NAME }).toBlob();
	const bytes = await blob.arrayBuffer();
	return { bytes, name, writer: `write-excel-file 4.1.1 (${String(bytes.byteLength)} bytes)` };
}
