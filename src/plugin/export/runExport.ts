/**
 * File names for the spreadsheet exports the native panel writes: the folder, the name prefix, the moment stamp,
 * and the first free path.
 *
 * The grid-store export runner (`exportTable`, `runExport`, `refusalFor`) was removed in R6 Slice 2c. It had no
 * caller in the shipped bundle. The native export reads the native table through `core/database/export`.
 *
 * The XLSX writer is a dynamic import in the native export panel (`../export/xlsx`), so it stays off the startup
 * path.
 */

/** The vault-relative folder every export is written to. Documented here, because the docs do not name one. */
export const EXPORT_FOLDER = 'Tablify exports';

/** The name every export starts with, before the moment and the suffix. */
export const EXPORT_PREFIX = 'Tablify export';

/** `2026-10-06 1432` — local time, because the file is for the person who clicked export. */
export function stamp(date: Date): string {
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * The free path for one export: `Tablify exports/Tablify export 2026-10-06 1432.tsv`, and ` 2`, ` 3`… when the
 * vault already holds that name. The ceiling of 999 is `core/import/naming.ts`'s own, and `exists` is the only
 * vault question this function asks more than once — it stops at the first free name.
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
