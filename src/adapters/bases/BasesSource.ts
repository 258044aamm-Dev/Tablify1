/**
 * `BasesSource`: the `RowSource` implementation that reads a real Bases view and writes through the queue.
 *
 * The design decision that matters is the **host port**. `docs/02` §Bases integration says the view's data
 * arrives in `BasesView.data` and is replaced wholesale on every update, and that `BasesEntry` has no write
 * path. Both facts are pushed behind `BasesViewHost` below, a structural slice we own, so that:
 *
 *  - this file imports nothing from `obsidian` and is testable against a fixture host (which is what
 *    `tests/unit/bases-source.test.ts` does);
 *  - the real adapter (`src/plugin/TablifyView.ts`) is the only place that touches `BasesView`, `config`,
 *    `getValue` and `fileManager` — one file to audit when the API changes;
 *  - a future `LegacySource` for `.tabula` files can reuse the port without a second copy of this logic.
 *
 * Three rules from the step this implements, each visible in the code:
 *
 * 1. **Rows are keyed by `file.path`, never by index** — the data array is recreated on every update, so an
 *    index would point at a different note after any change anywhere in the vault.
 * 2. **`getValue` is O(1) and allocates nothing** — it reads the in-memory row snapshot, which
 *    `subscribe` invalidates. No vault access, no parsing, no object creation per call.
 * 3. **Writes go through the queue only** — `apply` translates ops into `QueueWrite`s, and never calls
 *    `processFrontMatter` itself.
 *
 * Values are parsed with the registry's `parse`, so a cell the grid shows and the value a filter matches are
 * the same thing (step 8's rule). The raw YAML value is kept alongside in `raws`, because round-tripping an
 * unparsable cell must not silently replace it.
 */
import { applyResult } from '../RowSource';
import type { ApplyResult, PropertySchema, Refusal, RowId, RowSource } from '../RowSource';
import { createOverlay } from '../optimistic';
import type { Overlay } from '../optimistic';
import { createWriteQueue } from '../writeQueue';
import type { FrontmatterWriter, QueueWrite, TimerPort, WriteQueue } from '../writeQueue';
import type { Op, ViewPatch } from '../../core/ops/types';
import { propertyFromBasesId, resolveField } from '../../core/schema/propertySchema';
import { parseViewPatch } from '../../core/view/patch';
import type {
	FieldLookup,
	PropertyDefinition,
	ResolvedField,
} from '../../core/schema/propertySchema';
import type { CellValue, FieldContext, PropertyId, YamlValue } from '../../core/types';

/** One row as the host offers it. `filePath` is the identity; `label` is for messages. */
export type BasesRowHost = {
	readonly filePath: string;
	/** What a person calls this row: the file's basename, or a title property. */
	readonly label: string;
};

/**
 * The slice of a Bases view this source needs. Implemented over the real `BasesView` in
 * `src/plugin/TablifyView.ts`, and by a fixture in the tests.
 */
export type BasesViewHost = {
	/** The rows, in the order Bases sorted them (the API's payload arrives presorted). */
	rows(): readonly BasesRowHost[];
	/** Visible columns, in order, as prefixed property ids. */
	order(): readonly PropertyId[];
	/** The name the user gave a property in the `.base`, if any. */
	displayName(propertyId: PropertyId): string | undefined;
	/** The **raw** frontmatter value behind a property. Untrusted: this source parses it. */
	rawValue(filePath: string, propertyId: PropertyId): unknown;
	/** Reads one key of the view's own config (`.base` sidecar). `undefined` when unset. */
	config(key: string): unknown;
	/** Writes one key back. Absent on a read-only host, and then view changes are refused. */
	setConfig?(key: string, value: string): void;
	/** Fires when rows, values or the schema may have changed. */
	watch(listener: () => void): () => void;
	/** Opens the host's new-note flow. Present when the host can create rows. */
	createFileForView?(
		baseFileName: string | undefined,
		frontmatterProcessor: (frontmatter: Record<string, unknown>) => void,
	): Promise<void>;
};

/** Calls back on the next animation frame. A *function*, not a listener: nothing subscribes to `window`. */
export type FrameScheduler = (callback: () => void) => void;

/** The clock, timezone and locale every column context is built from. */
export type SourceEnvironment = {
	readonly now: () => number;
	readonly timezone: string;
	readonly locale: string;
};

/** Identity: a definition is used as-is; the helper exists to make the "add options" line read plainly. */
function definitionOf(definition: PropertyDefinition): PropertyDefinition {
	return definition;
}

/**
 * The YAML value a descriptor produced, back in the canonical cell shape the queue and the overlay speak.
 *
 * The two types differ by exactly one case: a YAML list may hold any scalar, while a cell list holds labels.
 * A `multiSelect` or `attachment` value therefore arrives as `readonly string[]` after a `String()` per
 * entry, and a `null` entry (which no descriptor produces for a list) becomes the empty string rather than
 * a hole. Scalars pass through untouched, including `null`, which the queue reads as "delete this key".
 */
export function toCellValue(value: YamlValue): CellValue {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return value;
	}
	return value.map((entry) => (entry === null ? '' : String(entry)));
}

/** One cell's canonical value plus the raw value it came from. */
type Cell = {
	readonly value: CellValue;
	readonly raw: unknown;
};

/** One row's snapshot: the identity, a label, and one entry per column the view has. */
type RowSnapshot = {
	readonly filePath: RowId;
	readonly label: string;
	readonly cells: ReadonlyMap<PropertyId, Cell>;
};

/** The sidecar key this plugin owns inside the view config. */
export const FIELD_OPTIONS_KEY = 'fieldOptions';

/** The sidecar key for the rest of the view patch (widths, hidden columns, order, grouping). */
export const VIEW_CONFIG_KEY = 'tablifyViewConfig';

/**
 * The sidecar key for how the view *looks* rather than what it shows: row density and the frozen primary
 * column.
 *
 * These two are deliberately **not** in `ViewPatch` (`src/core/view/patch.ts`) and could not be grafted onto it
 * without weakening the thing that file is built around. `ViewPatch` answers one question — which rows, and in
 * what arrangement — and its parser is total over that question's vocabulary; its fields all feed the query
 * pipeline. `density` and `frozenPrimary` feed nothing but a render, are not undoable, and were never part of a
 * query document. Widening the patch would put two presentation fields behind a parser every pipeline test
 * trusts. A second key costs one tolerant read and keeps both laws intact.
 *
 * One key per *view*, like the other two: a `.base` with two views can carry two densities.
 */
export const PRESENTATION_KEY = 'tablifyPresentation';

/**
 * The row density names the grid understands. Spelled out here on purpose: this is the adapter layer and
 * `src/grid` is the UI layer, so the union is duplicated rather than imported, and the parser below is what
 * guarantees the two spellings agree.
 */
export type StoredDensity = 'short' | 'medium' | 'tall';

/** A presentation change as the sidecar carries it. Every field optional: absent means "leave it alone". */
export type PresentationPatch = {
	readonly density?: StoredDensity;
	readonly frozenPrimary?: boolean;
};

/**
 * The narrowing `parseViewPatch` uses too (`src/core/view/patch.ts`): a type guard rather than a type assertion,
 * because the value came out of a file the user owns and `consistent-type-assertions` is a lint error here for
 * exactly that reason.
 */
const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** Total, like `parseViewPatch`: anything unrecognisable is dropped, an unreadable value is `{}`, never a throw. */
export function parsePresentation(raw: unknown): PresentationPatch {
	let value: unknown = raw;
	if (typeof raw === 'string') {
		// `host.config()` hands back whatever the `.base` holds: a string on a real host, an object in a test.
		try {
			value = JSON.parse(raw);
		} catch {
			return {};
		}
	}
	if (!isObject(value)) {
		return {};
	}
	const patch: { density?: StoredDensity; frozenPrimary?: boolean } = {};
	if (value.density === 'short' || value.density === 'medium' || value.density === 'tall') {
		patch.density = value.density;
	}
	if (typeof value.frozenPrimary === 'boolean') {
		patch.frozenPrimary = value.frozenPrimary;
	}
	return patch;
}

export type BasesSourceOptions = {
	readonly host: BasesViewHost;
	readonly writer: FrontmatterWriter;
	readonly env: SourceEnvironment;
	/** Injected so a test drives the queue with the fake clock. */
	readonly timers?: TimerPort;
	/** Injected so a test drives frame coalescing; defaults to `requestAnimationFrame`. */
	readonly schedule?: FrameScheduler;
	readonly debounceMs?: number;
	readonly concurrency?: number;
	/** Injected so tests can register a small registry; defaults to the shipped one. */
	readonly lookup?: FieldLookup;
};

/** A cell whose stored value could not be parsed. The raw value is kept; the UI may offer to fix it. */
export type CellProblem = {
	readonly filePath: RowId;
	readonly propertyId: PropertyId;
	readonly reason: string;
};

/** What the source can do, and what it refuses, reported once per `apply`. */
export type BasesSource = RowSource & {
	/** Rebuilds the snapshot from the host. Called by the host's own change notification, and by tests. */
	refresh(): void;
	/** The queue behind `apply`, exposed for `flush()` and for the view's "writing…" indicator. */
	readonly queue: WriteQueue;
	/**
	 * The optimistic overlay: the values typed but not yet on disk. Exposed for the same reason the queue is
	 * — the view paints `hasRow()` as a "writing" marker — and so a test can assert that one cell op leaves
	 * exactly one pending entry, which is the property that makes the grid feel instant without lying.
	 */
	readonly overlay: Overlay;
	/** The last `apply`'s results, for a status line. */
	lastResult(): ApplyResult | null;
	/** Values that could not be parsed, so the UI can say which cell is hand-edited or broken. */
	problems(): readonly CellProblem[];
	/**
	 * The view options this `.base` already carries, read out of the sidecar's `tablifyViewConfig`.
	 *
	 * This is the **read** half of the write path a few hundred lines down (`setViewConfig` /
	 * `setGroupCollapse` write `VIEW_CONFIG_KEY`); without it the patch survived in the file and nowhere else, so
	 * a pane switch or a reopened base dropped column order, hidden columns, grouping and collapsed groups on the
	 * floor — `docs/03` §Storage says the view's own settings live in the `.base` sidecar, and they have to come
	 * back out of it. Empty when the key is absent, unreadable, or holds nothing recognisable
	 * (`src/core/view/patch.ts` owns the tolerance).
	 */
	initialView(): ViewPatch;
	/**
	 * The presentation this view last stored, read out of the sidecar's `tablifyPresentation`. Empty when the
	 * key is absent, unreadable or holds nothing recognisable — and empty is the same answer a view that has
	 * never been configured gives, so the caller decides the defaults (see `parsePresentation`).
	 */
	initialPresentation(): PresentationPatch;
	/**
	 * Stores a presentation change. Presentation is not an edit: it is not undoable, it does not touch a note,
	 * and it does not go through the op pipeline — so this is a direct write rather than an 18th `Op` kind that
	 * every undo test would have to learn to ignore.
	 *
	 * Answers `false` on a read-only host (`setConfig` absent), which is the same answer the view-config path
	 * gives and the reason a view on a read-only host still renders the change: the render is the view's, the
	 * persistence is what is refused.
	 */
	setPresentation(patch: PresentationPatch): boolean;
};

/**
 * The default scheduler: one real frame inside Obsidian, and a microtask hop anywhere else.
 *
 * `window.requestAnimationFrame` is the popout-window-safe spelling of the frame API, and `window` is the
 * only place a frame exists. Outside one — a node test that constructs a view without injecting a scheduler
 * — there are no frames to align to, so the notification is deferred to a microtask: the contract that
 * matters (a burst of updates notifies once, *after* the burst) still holds, and nothing is dropped. Tests
 * that need to drive notifications by hand inject their own `schedule`; see `tests/unit/bases-source.test.ts`.
 */
const DEFAULT_SCHEDULE: FrameScheduler = (callback) => {
	const win = typeof window === 'undefined' ? undefined : window;
	if (win !== undefined && typeof win.requestAnimationFrame === 'function') {
		win.requestAnimationFrame(() => {
			callback();
		});
		return;
	}
	void Promise.resolve().then(() => {
		callback();
	});
};

export function createBasesSource(options: BasesSourceOptions): BasesSource {
	const { host, env } = options;
	const schedule: FrameScheduler = options.schedule ?? DEFAULT_SCHEDULE;

	const listeners = new Set<() => void>();
	let notified = false;
	let disposed = false;
	let schema: readonly ResolvedField[] = [];
	let rows: readonly RowSnapshot[] = [];
	/**
	 * The one notification path: coalesced to one call per frame, whatever the trigger — a host update, or
	 * the overlay changing because a write landed. Ten rapid updates of either kind are one repaint.
	 */
	const notifyOnce = (): void => {
		if (notified || disposed) {
			return;
		}
		notified = true;
		schedule(() => {
			notified = false;
			for (const listener of [...listeners]) {
				listener();
			}
		});
	};

	/** Derived once per refresh, so `getRows()` — a per-render call — allocates nothing. */
	let rowIds: readonly RowId[] = [];
	let lastApply: ApplyResult | null = null;
	let problems: CellProblem[] = [];

	const overlay = createOverlay();
	const queue: WriteQueue = createWriteQueue({
		writer: options.writer,
		...(options.timers === undefined ? {} : { timers: options.timers }),
		...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
		...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
		/**
		 * The two handovers. A write that landed means the value is no longer pending — the file is the
		 * source of truth again, and `settle` removes the entry *only if it is still that value*, so a newer
		 * keystroke typed while the write was in flight stays pending. A write that failed must leave the
		 * overlay entirely, because the grid's next paint has to show what the file really contains rather
		 * than a value that never landed.
		 */
		hooks: {
			onWritten: (writes) => {
				overlay.settle(writes);
			},
			onFailed: (writes) => {
				overlay.drop(writes);
			},
		},
	});
	/** One repaint per frame when the pending set changes: a 400-cell paste notifies once. */
	const stopOverlay = overlay.subscribe(notifyOnce);

	/** The base context for one row: same environment, that row's path. */
	const contextFor = (filePath: RowId, field: ResolvedField): FieldContext => ({
		...field.context,
		path: filePath,
	});

	/** Reads the sidecar's `fieldOptions` map: `{ "note.Status": { type: "singleSelect", … } }`. */
	const fieldOptionsFromConfig = (): ReadonlyMap<PropertyId, unknown> => {
		const map = new Map<PropertyId, unknown>();
		const raw = host.config(FIELD_OPTIONS_KEY);
		if (typeof raw !== 'string' || raw.trim() === '') {
			return map;
		}
		try {
			const parsed: unknown = JSON.parse(raw);
			if (typeof parsed !== 'object' || parsed === null) {
				return map;
			}
			const fields: unknown = Reflect.get(parsed, 'fields');
			if (typeof fields !== 'object' || fields === null) {
				return map;
			}
			for (const [id, value] of Object.entries(fields)) {
				map.set(id, value);
			}
		} catch {
			// A hand-edited sidecar must not break the grid: the whole point of the fallback path below.
			return map;
		}
		return map;
	};

	/** Builds the column list: the view's own order first, then anything the sidecar knows about. */
	const buildSchema = (): readonly ResolvedField[] => {
		const sidecar = fieldOptionsFromConfig();
		const ids: PropertyId[] = [];
		for (const id of [...host.order(), ...sidecar.keys()]) {
			if (!ids.includes(id)) {
				ids.push(id);
			}
		}
		return ids.map((id) => {
			const base = propertyFromBasesId(id);
			const fieldOptions = sidecar.get(id);
			const definition: PropertyDefinition =
				fieldOptions === undefined ? base : { ...definitionOf(base), fieldOptions };
			// A rename in the `.base` changes what messages call the column, never the key frontmatter
			// stores: `definition.name` stays the property name, exactly as `docs/03` §write rules 4 says.
			const columnName = host.displayName(id) ?? definition.name;
			const ctx: FieldContext = {
				path: '',
				now: env.now,
				timezone: env.timezone,
				locale: env.locale,
				fieldOptions: {},
				columnName,
			};
			return options.lookup === undefined
				? resolveField(definition, ctx)
				: resolveField(definition, ctx, options.lookup);
		});
	};

	/** Rebuilds the row snapshot. One pass over the host's rows, one parse per cell. */
	const buildRows = (): readonly RowSnapshot[] => {
		const found: RowSnapshot[] = [];
		const issues: CellProblem[] = [];
		for (const hostRow of host.rows()) {
			const cells = new Map<PropertyId, Cell>();
			for (const field of schema) {
				// A field with no raw value is an empty cell; `parse(undefined)` is each type's own "empty".
				// (This comment stays short on purpose: the branch below is the interesting one.)
				const raw = host.rawValue(hostRow.filePath, field.definition.id);
				const parsed = field.descriptor.parse(raw, contextFor(hostRow.filePath, field));
				if (parsed.ok) {
					cells.set(field.definition.id, { value: parsed.value, raw });
				} else {
					// The raw value is kept, so a round trip never replaces a value we merely failed to read.
					cells.set(field.definition.id, { value: null, raw });
					issues.push({
						filePath: hostRow.filePath,
						propertyId: field.definition.id,
						reason: parsed.error,
					});
				}
			}
			found.push({ filePath: hostRow.filePath, label: hostRow.label, cells });
		}
		problems = issues;
		return found;
	};

	/** One rebuild. Cheap by construction: two passes over the rows the host already has in memory. */
	const refresh = (): void => {
		if (disposed) {
			return;
		}
		schema = buildSchema();
		rows = buildRows();
		rowIds = rows.map((row) => row.filePath);
		// Frame coalescing: ten rapid updates from the host become one notification, one repaint.
		notifyOnce();
	};

	const stopWatching = host.watch(() => {
		refresh();
	});
	refresh();

	/** Turns one op's writes into `QueueWrite`s, refusing read-only columns instead of writing them. */
	const translate = (op: Op): { readonly writes: QueueWrite[]; readonly refused: Refusal[] } => {
		const refused: Refusal[] = [];
		const writes: QueueWrite[] = [];
		const push = (filePath: RowId, propertyId: PropertyId, value: CellValue): void => {
			const field = schema.find((candidate) => candidate.definition.id === propertyId);
			if (field === undefined) {
				refused.push({
					filePath,
					propertyId,
					reason: 'readonly-column',
					message: `the column "${propertyId}" is not in this view`,
				});
				return;
			}
			if (field.readOnly) {
				refused.push({
					filePath,
					propertyId,
					reason: 'readonly-column',
					message: `${field.context.columnName} is read-only (${
						field.reasons.find((reason) => reason.startsWith('read-only')) ??
						'not writable'
					})`,
				});
				return;
			}
			writes.push({
				filePath,
				// The queue's key is the **frontmatter key**, never the Bases property id: `docs/03` §write
				// rules 4 — a rename in the `.base` changes what a message calls the column, not the key the
				// note stores. `getValue` maps the other way, so a caller keeps speaking Bases ids.
				propertyId: field.definition.name,
				value: toCellValue(field.descriptor.toYaml(value, field.context)),
			});
		};
		switch (op.kind) {
			case 'setCell': {
				push(op.filePath, op.fieldId, op.value);
				break;
			}
			case 'setCells': {
				for (const write of op.writes) {
					push(write.filePath, write.fieldId, write.value);
				}
				break;
			}
			case 'clearCells': {
				for (const cell of op.cells) {
					push(cell.filePath, cell.fieldId, null);
				}
				break;
			}
			default: {
				break;
			}
		}
		return { writes, refused };
	};

	/** Writes the sidecar's `fieldOptions` map back as one JSON string. */
	const saveFieldOptions = (next: Map<PropertyId, string>): void => {
		if (host.setConfig === undefined) {
			return;
		}
		host.setConfig(
			FIELD_OPTIONS_KEY,
			JSON.stringify({ version: 1, fields: Object.fromEntries(next) }),
		);
	};

	return {
		kind: 'bases',
		writable: true,
		readonly: false,
		canCreateRows: host.createFileForView !== undefined,
		// Deleting a row deletes a note. That is a destructive, multi-file operation with its own review
		// step in the plan (step 23), so the source says `false` rather than doing it quietly here.
		canDeleteRows: false,
		queue,
		overlay,

		initialView(): ViewPatch {
			return parseViewPatch(host.config(VIEW_CONFIG_KEY));
		},

		initialPresentation(): PresentationPatch {
			return parsePresentation(host.config(PRESENTATION_KEY));
		},

		setPresentation(patch: PresentationPatch): boolean {
			if (host.setConfig === undefined) {
				return false;
			}
			// Merge onto what is there, so a density change does not drop the freeze and vice versa. The stored
			// value is a string in the `.base` (the same way `VIEW_CONFIG_KEY` is stored), never a nested object.
			const next = { ...parsePresentation(host.config(PRESENTATION_KEY)), ...patch };
			host.setConfig(PRESENTATION_KEY, JSON.stringify(next));
			return true;
		},

		getSchema(): PropertySchema {
			return { fields: schema };
		},

		getRows(): readonly RowId[] {
			return rowIds;
		},

		getValue(row: RowId, propertyId: PropertyId): CellValue {
			// Optimistic first: a value the user typed is shown until the write lands or fails. The overlay
			// speaks frontmatter keys, so the lookup goes through the column's own name.
			const field = schema.find((candidate) => candidate.definition.id === propertyId);
			if (field !== undefined) {
				const pending = overlay.get(row, field.definition.name);
				if (pending !== undefined) {
					return pending;
				}
			}
			const snapshot = rows.find((candidate) => candidate.filePath === row);
			return snapshot?.cells.get(propertyId)?.value ?? null;
		},

		getRowLabel(row: RowId): string {
			return rows.find((candidate) => candidate.filePath === row)?.label ?? row;
		},

		async apply(ops: readonly Op[]): Promise<ApplyResult> {
			const refused: Refusal[] = [];
			const writes: QueueWrite[] = [];
			const files: RowId[] = [];
			for (const op of ops) {
				if (op.kind === 'setFieldOptions') {
					const current = fieldOptionsFromConfig();
					const next = new Map<PropertyId, string>();
					for (const [id, value] of current) {
						next.set(id, JSON.stringify(value));
					}
					next.set(op.fieldId, JSON.stringify(op.to));
					saveFieldOptions(next);
					files.push(op.fieldId);
					continue;
				}
				if (op.kind === 'setViewConfig' || op.kind === 'setGroupCollapse') {
					if (host.setConfig === undefined) {
						refused.push({
							filePath: '',
							propertyId: VIEW_CONFIG_KEY,
							reason: 'not-writable',
							message: 'this view cannot store its own settings',
						});
						continue;
					}
					const patch =
						op.kind === 'setGroupCollapse' ? { collapsedKeys: [op.key] } : op.changes;
					host.setConfig(VIEW_CONFIG_KEY, JSON.stringify(patch));
					continue;
				}
				if (op.kind === 'addRow') {
					if (host.createFileForView === undefined) {
						refused.push({
							filePath: op.row.filePath,
							propertyId: '',
							reason: 'not-writable',
							message: 'this view cannot create notes',
						});
						continue;
					}
					const frontmatter: Record<string, unknown> = {};
					for (const [propertyId, value] of Object.entries(op.row.cells)) {
						const field = schema.find(
							(candidate) => candidate.definition.id === propertyId,
						);
						if (field !== undefined && !field.readOnly) {
							frontmatter[field.definition.name] = field.descriptor.toYaml(
								value,
								field.context,
							);
						}
					}
					await host.createFileForView(undefined, (target) => {
						for (const [key, value] of Object.entries(frontmatter)) {
							target[key] = value;
						}
					});
					continue;
				}
				const translated = translate(op);
				writes.push(...translated.writes);
				for (const refusal of translated.refused) {
					refused.push(refusal);
				}
			}
			if (writes.length > 0) {
				// One batch, one overlay change, one queued flush: the same `QueueWrite[]` is both the thing
				// painted now and the thing written in 250 ms, so the two can never disagree.
				overlay.set(writes);
				queue.enqueue(writes);
				for (const write of writes) {
					if (!files.includes(write.filePath)) {
						files.push(write.filePath);
					}
				}
			}
			lastApply = applyResult({
				written: writes.length,
				files,
				refused,
				errors: [],
			});
			return lastApply;
		},

		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		async flush(): Promise<void> {
			const result = await queue.flush();
			if (result.errors.length > 0 && lastApply !== null) {
				lastApply = applyResult({
					written: lastApply.written,
					files: lastApply.files,
					refused: lastApply.refused,
					errors: result.errors,
				});
			}
		},

		refresh,

		lastResult(): ApplyResult | null {
			return lastApply;
		},

		problems(): readonly CellProblem[] {
			return problems;
		},

		dispose(): void {
			disposed = true;
			stopWatching();
			stopOverlay();
			listeners.clear();
			overlay.clear();
			queue.dispose();
		},
	};
}
