/**
 * The neutral shape of a legacy `.tabula` file, and the mapping from its types onto this project's registry.
 *
 * `docs/03-data-model-and-migration.md` §the `.tabula` format (frozen) is the specification: two on-disk
 * shapes (a bare v1 document, and the v2 `{version: 2, tables: [...]}` envelope), rows keyed by field id,
 * select cells storing **option ids** rather than labels, and the 19-type legacy union with
 * `singleSelect`/`multiSelect` carrying `{ id, name, color }` options.
 *
 * The types below are deliberately *not* the fork's interfaces reused: the fork's `Field` is a 19-way
 * discriminated union it can write, while this is a read-only model that must also represent what the fork
 * never wrote — an unknown type, a missing id, an orphaned option id — without losing anything. Every lossy
 * case is a field on this model, never a silent fallback.
 *
 * Read-only by construction: nothing here writes `.tabula`, and every exported function is pure.
 */
import type { CellValue, FieldOptions, FieldTypeId, PropertyId } from '../../core/types';

/** One select option, exactly as stored: `{ id, name, color }`. `color` is absent in hand-edited files. */
export type TabulaOption = {
	readonly id: string;
	readonly name: string;
	readonly color: string | null;
};

/** A legacy cell. Select cells hold option **ids**; multi-select and attachment cells hold lists. */
export type TabulaCell = string | number | boolean | null | readonly string[];

/** One column, as read. `legacyType` keeps the original spelling even when it is unknown to this build. */
export type TabulaField = {
	readonly id: string;
	readonly name: string;
	/** The `type` string exactly as it appeared in the file (`'text'`, `'autoNumber'`, `'lookup'`, …). */
	readonly legacyType: string;
	/** True when `legacyType` is not one of the 19 legacy types — kept as a column, reported, never dropped. */
	readonly unknown: boolean;
	readonly options: readonly TabulaOption[];
	/** A `currency` symbol. Absent means "the default". */
	readonly symbol: string | null;
	/** A `rating` maximum. Absent means "the default". */
	readonly max: number | null;
};

export type TabulaRow = {
	readonly id: string;
	readonly cells: Readonly<Record<string, TabulaCell>>;
};

/** One legacy sort level. The legacy direction is `'asc' | 'desc'`; anything else is reported, not guessed. */
export type TabulaSort = {
	readonly fieldId: string;
	readonly direction: string;
};

/** One legacy filter condition. `value` is `CellValue`-shaped, including a list for the "any of" operators. */
export type TabulaFilterCondition = {
	readonly fieldId: string;
	readonly operator: string;
	readonly value: CellValue;
};

export type TabulaFilterGroup = {
	readonly logic: string;
	readonly conditions: readonly TabulaFilterCondition[];
};

/** The legacy view state, field for field. Everything here has a documented destination or no destination. */
export type TabulaView = {
	readonly sorts: readonly TabulaSort[];
	readonly filters: TabulaFilterGroup;
	readonly search: string;
	readonly query: string;
	readonly hiddenFieldIds: readonly string[];
	readonly groupBy: string | null;
	readonly columnWidths: Readonly<Record<string, number>>;
	readonly rowHeight: string;
	readonly frozenPrimary: boolean;
};

/** The legacy sync link. Read for the record; the token was never in the file (`docs/03` §sync state). */
export type TabulaSync = {
	readonly baseId: string;
	readonly tableId: string;
	readonly baseName: string | null;
	readonly tableName: string | null;
	readonly mappedFields: number;
	readonly mappedRecords: number;
};

export type TabulaTable = {
	/** The v2 entry id, or a synthesised `t_1` for a v1 document. */
	readonly id: string;
	readonly name: string;
	readonly fields: readonly TabulaField[];
	readonly rows: readonly TabulaRow[];
	readonly view: TabulaView;
	/** Where the fork's auto-number counter had got to. Discarded with the column; reported. */
	readonly autoNumberNext: number | null;
	readonly sync: TabulaSync | null;
};

export type TabulaDoc = {
	readonly path: string;
	readonly version: 1 | 2;
	readonly tables: readonly TabulaTable[];
	/**
	 * Everything tolerated rather than refused: an unknown type, a row without cells, a value for a column
	 * that does not exist, a missing version field. The dry-run report carries them to the dialog, so a
	 * tolerant read is never a silent one.
	 */
	readonly warnings: readonly TabulaWarning[];
};

/** One tolerated irregularity. `where` is a human-readable location inside the file, not an index. */
export type TabulaWarning = {
	readonly code: TabulaWarningCode;
	/** The table this warning belongs to, 0-based. Absent for a warning about the document itself. */
	readonly tableIndex?: number;
	readonly where: string;
	readonly message: string;
};

export type TabulaWarningCode =
	| 'missing-version'
	| 'unknown-type'
	| 'missing-field-id'
	| 'missing-field-name'
	| 'missing-row-cells'
	| 'missing-cell-column'
	| 'extra-cell-column'
	| 'unknown-sort-direction'
	| 'duplicate-table-id'
	| 'unexpected-cell-shape'
	| 'skipped-table-entry';

/** A refusal, with everything a person needs to find the problem. Never thrown, always returned. */
export type TabulaError = {
	readonly path: string;
	/** 1-based, when the engine gave a position or the problem can be located in the text. */
	readonly line?: number;
	/** 1-based. */
	readonly column?: number;
	readonly message: string;
	/** The offending line, trimmed, at most 120 characters. */
	readonly excerpt: string;
	readonly cause?: unknown;
};

export type TabulaResult =
	| { readonly ok: true; readonly doc: TabulaDoc }
	| { readonly ok: false; readonly error: TabulaError };

/** The maximum excerpt length, in characters, per the step's contract. */
export const EXCERPT_LIMIT = 120;

/** The 19 legacy types, in the fork's own order. Used to tell "known" from "unknown", nothing else. */
export const LEGACY_TYPES: readonly string[] = [
	'text',
	'longText',
	'number',
	'currency',
	'percent',
	'duration',
	'rating',
	'checkbox',
	'date',
	'datetime',
	'url',
	'email',
	'phone',
	'singleSelect',
	'multiSelect',
	'attachment',
	'autoNumber',
	'createdTime',
	'lastModifiedTime',
];

/**
 * How one legacy type lands in this build.
 *
 * - `target` is the registry id the column becomes, or `null` when this build has no equivalent at all.
 * - `stored` says whether the column's values go into a note's frontmatter. `false` for `createdTime` and
 *   `lastModifiedTime`: those are `file.ctime`/`file.mtime` columns here (`docs/03` §field type mapping —
 *   "not stored — read from file metadata"), so the column survives and the values are recomputed by
 *   Obsidian rather than copied. The legacy values are therefore reported as not carried, which is exactly
 *   the kind of loss the dry-run exists to state.
 */
export type FieldMapping = {
	readonly field: TabulaField;
	readonly target: FieldTypeId | null;
	readonly stored: boolean;
	/** One sentence for the report: why this column maps where it does. */
	readonly note: string;
};

/** Legacy type id → registry id, for the sixteen types that map one-to-one. */
const IDENTICAL: Readonly<Record<string, FieldTypeId>> = {
	text: 'text',
	longText: 'longText',
	number: 'number',
	currency: 'currency',
	percent: 'percent',
	duration: 'duration',
	rating: 'rating',
	checkbox: 'checkbox',
	date: 'date',
	datetime: 'datetime',
	url: 'url',
	email: 'email',
	phone: 'phone',
	singleSelect: 'singleSelect',
	multiSelect: 'multiSelect',
	attachment: 'attachment',
};

/** Legacy type ids that become read-only file-metadata columns. Their stored values are not copied. */
const METADATA: Readonly<Record<string, FieldTypeId>> = {
	createdTime: 'createdTime',
	lastModifiedTime: 'lastModifiedTime',
};

/** Every legacy type this build can express somewhere. `autoNumber` is deliberately absent. */
export const MAPPED_TYPES: readonly string[] = [
	...Object.keys(IDENTICAL),
	...Object.keys(METADATA),
];

/** The one legacy type with no equivalent in a file-backed grid. */
export const DROPPED_TYPES: readonly string[] = ['autoNumber'];

/**
 * Where a legacy column lands. Unknown types are **kept as text** and marked, never dropped: a column with
 * values in it must not vanish because this build does not recognise the type's name.
 */
export function fieldMapping(field: TabulaField): FieldMapping {
	const identical = IDENTICAL[field.legacyType];
	if (identical !== undefined) {
		return {
			field,
			target: identical,
			stored: true,
			note: `stored as “${field.legacyType}” frontmatter`,
		};
	}
	const metadata = METADATA[field.legacyType];
	if (metadata !== undefined) {
		return {
			field,
			target: metadata,
			stored: false,
			note: `${field.legacyType} becomes a file-metadata column; the stored values are not copied`,
		};
	}
	if (field.legacyType === 'autoNumber') {
		return {
			field,
			target: null,
			stored: false,
			note: 'autoNumber has no equivalent with file-backed rows; the column and its values are dropped',
		};
	}
	return {
		field,
		target: 'text',
		stored: true,
		note: `unknown legacy type “${field.legacyType}” — the column is kept as text, so no value is lost`,
	};
}

/** Every column of a table with its destination. This is what the dry-run iterates. */
export function toFieldDescriptors(table: TabulaTable): readonly FieldMapping[] {
	return table.fields.map((field) => fieldMapping(field));
}

/** One property name: the legacy field name, trimmed, with internal whitespace collapsed. */
export function propertyNameOf(name: string, fallback: string): string {
	const collapsed = name.replace(/\s+/g, ' ').trim();
	return collapsed === '' ? fallback : collapsed;
}

/**
 * Obsidian reads these three keys for its own purposes (`docs/03` §write rules 5). Using one as a column is
 * allowed; the migration says so out loud rather than changing the name behind the user's back.
 */
export const RESERVED_PROPERTY_NAMES: readonly string[] = ['tags', 'aliases', 'cssclasses'];

/** One column's resolved property name, and what had to be decided to get it. */
export type ResolvedColumn = {
	readonly fieldId: string;
	readonly sourceName: string;
	/** The legacy type, kept so a metadata column can be named for the property Obsidian already has. */
	readonly legacyType: string;
	readonly propertyName: string;
	/** True when the name changed because another column already had it. */
	readonly renamed: boolean;
	readonly reserved: boolean;
	/** Where the values go: `property` in frontmatter, `view` as the `.base` column id, or `dropped`. */
	readonly destination: 'property' | 'view' | 'dropped';
};

/**
 * Resolves every column name for one table: trimmed, collapsed, and de-duplicated with the documented
 * ` 2`, ` 3` suffixes (`docs/03` §write rules 4). The *order* of the fields decides who keeps the plain
 * name, so the result is stable for a given file and a report can be compared between runs.
 */
export function resolveColumns(table: TabulaTable): readonly ResolvedColumn[] {
	const used = new Set<string>();
	return toFieldDescriptors(table).map((mapping, index) => {
		const sourceName = mapping.field.name;
		const base = propertyNameOf(sourceName, `Column ${String(index + 1)}`);
		let candidate = base;
		let renamed = false;
		let suffix = 2;
		while (used.has(candidate.toLowerCase())) {
			candidate = `${base} ${String(suffix)}`;
			suffix += 1;
			renamed = true;
		}
		used.add(candidate.toLowerCase());
		return {
			fieldId: mapping.field.id,
			sourceName,
			legacyType: mapping.field.legacyType,
			propertyName: candidate,
			renamed,
			reserved: RESERVED_PROPERTY_NAMES.includes(candidate.toLowerCase()),
			destination: mapping.target === null ? 'dropped' : mapping.stored ? 'property' : 'view',
		};
	});
}

/** The Bases property id a migrated column gets: `note.<property name>`, exactly as a `.base` file spells it. */
export function columnPropertyId(column: ResolvedColumn): PropertyId {
	return column.destination === 'view'
		? `file.${viewPropertyName(column)}`
		: `note.${column.propertyName}`;
}

/**
 * The `file.` property a metadata column becomes. Obsidian already has both: `createdTime` is `file.ctime`
 * and `lastModifiedTime` is `file.mtime` (`docs/03` §field type mapping — "not stored — read from
 * `file.ctime`"). The column therefore arrives as a read-only Bases column with no frontmatter at all.
 */
function viewPropertyName(column: ResolvedColumn): string {
	switch (column.legacyType) {
		case 'createdTime':
			return 'ctime';
		case 'lastModifiedTime':
			return 'mtime';
		default:
			return column.propertyName;
	}
}

/**
 * The list arm of a cell, as a type predicate. `Array.isArray` narrows a `readonly string[]` to `any[]`, which
 * would leak `any` into everything downstream; this keeps the elements typed as the strings they are.
 */
function isStringList(value: TabulaCell | undefined): value is readonly string[] {
	return Array.isArray(value);
}

/** The label a select cell's stored option id resolves to; an orphan keeps its raw value, never dropped. */
export function optionLabel(field: TabulaField, value: string): string {
	return field.options.find((option) => option.id === value)?.name ?? value;
}

/** True when a select cell's value is an option id the field no longer has. */
export function isOrphan(field: TabulaField, value: string): boolean {
	return field.options.every((option) => option.id !== value);
}

/** One select value whose option is gone. It is written as text, and the report says which value it was. */
export type OrphanSelection = {
	readonly rowId: string;
	readonly fieldId: string;
	readonly value: string;
};

/**
 * Every select value in a table that references an option the field does not have.
 *
 * These are the values the fork lost silently — one option deletion and the rows that used it went blank
 * (`prototype/AUDIT-REPORT.md` finding 11). Here the value survives as text and is reported first.
 */
export function orphanSelections(table: TabulaTable): readonly OrphanSelection[] {
	const found: OrphanSelection[] = [];
	for (const field of table.fields) {
		const isSelect = field.legacyType === 'singleSelect' || field.legacyType === 'multiSelect';
		if (!isSelect) {
			continue;
		}
		const multiple = field.legacyType === 'multiSelect';
		for (const row of table.rows) {
			const value = row.cells[field.id];
			if (multiple) {
				if (!isStringList(value)) {
					continue;
				}
				for (const entry of value) {
					if (isOrphan(field, entry)) {
						found.push({ rowId: row.id, fieldId: field.id, value: entry });
					}
				}
				continue;
			}
			if (typeof value === 'string' && isOrphan(field, value)) {
				found.push({ rowId: row.id, fieldId: field.id, value });
			}
		}
	}
	return found;
}

/** One cell as plain text: what a person would have typed, which is what a paste matrix carries. */
export function cellToPlain(field: TabulaField, value: TabulaCell | undefined): string {
	if (value === undefined || value === null) {
		return '';
	}
	if (typeof value === 'string') {
		return field.legacyType === 'singleSelect' ? optionLabel(field, value) : value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	// A list: multi-select option ids, or attachment paths. Labels, in the stored order.
	const isSelect = field.legacyType === 'multiSelect';
	return isStringList(value)
		? value.map((entry) => (isSelect ? optionLabel(field, entry) : entry)).join(', ')
		: '';
}

/**
 * The paste matrix: one array of plain-text cells per row, in column order, ready for the importer's
 * header-matching path. Select ids are resolved to labels here and nowhere else, which is the one place the
 * id-to-label translation for display lives.
 */
export function toMatrix(table: TabulaTable): readonly (readonly string[])[] {
	return table.rows.map((row) =>
		table.fields.map((field) => cellToPlain(field, row.cells[field.id])),
	);
}

/** The `fieldOptions` entry a migrated column needs, or `null` when the column has no options of its own. */
export function fieldOptionsFor(mapping: FieldMapping): FieldOptions | null {
	const { field, target } = mapping;
	if (target === null) {
		return null;
	}
	if (target === 'singleSelect' || target === 'multiSelect') {
		// Option identity here is the label (`docs/03` §`fieldOptions` shape), and the colour travels in the
		// sidecar so a migrated select keeps the colours it had.
		return {
			type: target,
			options: field.options.map((option) =>
				option.color === null
					? { id: option.id, name: option.name }
					: { id: option.id, name: option.name, color: option.color },
			),
		};
	}
	if (target === 'rating' && field.max !== null) {
		return { type: target, max: field.max };
	}
	if (target === 'currency' && field.symbol !== null) {
		return { type: target, symbol: field.symbol };
	}
	return null;
}
