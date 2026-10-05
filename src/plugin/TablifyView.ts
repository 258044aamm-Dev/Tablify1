/**
 * The real Bases view, with a deliberately plain body.
 *
 * Step 12's job is the **data path**, not the grid: this view proves that a Bases view can read rows,
 * resolve columns through the registry, write a cell through the queue, and show the result. The DOM below
 * is a five-line placeholder on purpose — the grid, the tokens and the layout contract arrive in steps 15
 * and 17, and building a pretty table now would only be thrown away.
 *
 * It is also the **only** file in the plugin that touches `BasesView`, `config`, `BasesEntry.getValue`,
 * `fileManager.processFrontMatter` and `createFileForView`. Everything else works against the structural
 * ports in `src/adapters/`, which is what keeps the core testable without a vault.
 *
 * Facts this file leans on, all read from `obsidian.d.ts` @ 1.13.1 (see `spike/bases-path/FINDINGS.md`):
 * `BasesView` declares `type`, `app`, `config`, `allProperties`, `data`, `onDataUpdated()`,
 * `createFileForView()` — and **no `containerEl`**, so the factory's second argument is kept here (the one
 * doc correction the spike produced). `BasesEntry` has exactly `file` and `getValue()` and no write path,
 * so every write goes through `fileManager.processFrontMatter` (`@since 1.4.4`).
 */
import {
	BasesView,
	type BasesPropertyId,
	type EventRef,
	type QueryController,
	type TFile,
} from 'obsidian';

import { createBasesSource } from '../adapters/bases/BasesSource';
import type { BasesRowHost, BasesViewHost, CellProblem } from '../adapters/bases/BasesSource';
import type { ApplyResult } from '../adapters/RowSource';

/**
 * Is this a Bases property id? `BasesPropertyId` is `` `${BasesPropertyType}.${string}` `` (obsidian.d.ts
 * @1.10.0), so the test is the prefix, and it is a type predicate rather than an assertion: a bare property
 * name is a legitimate value in a `.base` order list and must not be forced into the prefixed shape.
 */
function isBasesPropertyId(value: string): value is BasesPropertyId {
	const separator = value.indexOf('.');
	if (separator <= 0) {
		return false;
	}
	const prefix = value.slice(0, separator);
	return prefix === 'file' || prefix === 'note' || prefix === 'formula';
}

/** The heading the placeholder shows. Kept as a constant so a test can assert on it. */
export const TABLIFY_VIEW_STATUS_PREFIX = 'Tablify — ';

/** Everything the placeholder needs to render one line of truth. */
export type ViewSummary = {
	readonly rows: number;
	readonly fields: number;
	readonly sample: readonly string[];
	readonly status: string;
};

/**
 * Builds the summary line the view shows: how many rows and columns, the first three rows' values rendered
 * by their own columns, and one sentence about the last write (or the last problem).
 *
 * It is a pure function on purpose — the interesting behaviour is testable without a DOM or a view.
 */
export function summarize(input: {
	readonly rows: readonly string[];
	readonly fields: readonly {
		readonly id: string;
		readonly display: (filePath: string) => string;
	}[];
	readonly lastResult: ApplyResult | null;
	readonly problems: readonly CellProblem[];
}): ViewSummary {
	const sample = input.rows.slice(0, 3).map((filePath) => {
		const cells = input.fields.map((field) => `${field.id}=${field.display(filePath)}`);
		return `${filePath}: ${cells.join(', ')}`;
	});
	const status = describeStatus(
		input.lastResult,
		input.problems,
		input.rows.length,
		input.fields.length,
	);
	return { rows: input.rows.length, fields: input.fields.length, sample, status };
}

/** One sentence about the last thing that happened. Never empty, so the placeholder always says something. */
function describeStatus(
	result: ApplyResult | null,
	problems: readonly CellProblem[],
	rows: number,
	fields: number,
): string {
	const parts: string[] = [`${String(rows)} rows × ${String(fields)} columns`];
	if (result !== null) {
		parts.push(
			result.errors.length > 0
				? `last write: ${String(result.errors.length)} failed`
				: `last write: ${String(result.written)} cell(s) to ${String(result.files.length)} file(s)`,
		);
	}
	if (problems.length > 0) {
		parts.push(`${String(problems.length)} cell(s) could not be read`);
	}
	if (result !== null && result.refused.length > 0) {
		parts.push(`${String(result.refused.length)} refused (read-only)`);
	}
	return parts.join(' · ');
}

/**
 * The view. Bases calls `onDataUpdated()` whenever the query result or the config changes; this view hands
 * that event to its `BasesSource` and re-renders the placeholder from the source's snapshot.
 */
export class TablifyView extends BasesView {
	/** BasesView.type: abstract string — obsidian.d.ts, @since 1.10.0. Must equal the registered id. */
	readonly type: string;

	/** The container the factory was handed. `BasesView` declares no `containerEl`; see the file header. */
	private readonly containerEl: HTMLElement;

	private readonly host: HTMLElement;
	private readonly source: ReturnType<typeof createBasesSource>;
	private readonly cleanup: (() => void)[] = [];
	/** The source's refresh listeners. Bases' own `onDataUpdated` is the event; no DOM listener is needed. */
	private readonly watchers = new Set<() => void>();
	/** The app's metadata listener, so an external edit reaches the source. Released in `dispose()`. */
	private metadataRef: EventRef | null = null;

	constructor(
		controller: QueryController,
		containerEl: HTMLElement,
		type: string,
		environment: {
			readonly now: () => number;
			readonly timezone: string;
			readonly locale: string;
		},
	) {
		// BasesView constructor(controller: QueryController): protected — obsidian.d.ts, @since 1.10.0.
		super(controller);
		this.type = type;
		this.containerEl = containerEl;
		this.host = containerEl.createDiv({ cls: 'tablify-view-host' });
		this.source = createBasesSource({
			host: this.basesHost(),
			writer: {
				// App['fileManager'].processFrontMatter(file, fn, options?): Promise<void> — obsidian.d.ts,
				// @since 1.4.4. The callback mutates the object it is given, which is what preserves keys.
				processFrontMatter: async (path, mutate) => {
					const file = this.app.vault.getFileByPath(path);
					if (file === null) {
						throw new Error(`Tablify: the note "${path}" is gone`);
					}
					await this.app.fileManager.processFrontMatter(file, mutate);
				},
			},
			env: environment,
		});
		this.cleanup.push(
			this.source.subscribe(() => {
				this.render();
			}),
		);
		/**
		 * External changes. The step's contract for `subscribe` is "the view's data-update **and** vault
		 * metadata changes that touch a file in the row set", and this is that second half: the app's own
		 * `MetadataCache.on('changed')` event, filtered to the rows this view is showing. It is **not** a
		 * `window` listener — the emitter is owned by the app and the ref is released in `dispose()` — which
		 * is the alternative the step's STOP clause asks about. `typeof … === 'function'` guards the app
		 * doubles in tests, which model a vault and a cache but not an event emitter.
		 */
		const cache = this.app.metadataCache;
		if (typeof cache.on === 'function') {
			this.metadataRef = cache.on('changed', (file: TFile) => {
				if (!this.source.getRows().includes(file.path)) {
					return;
				}
				for (const notify of [...this.watchers]) {
					notify();
				}
			});
		}
	}

	/** The structural port, implemented over the real API. One method per member the source needs. */
	private basesHost(): BasesViewHost {
		return {
			rows: (): readonly BasesRowHost[] =>
				this.data.data.map((entry) => ({
					filePath: entry.file.path,
					label: entry.file.basename,
				})),
			// Visible properties, in the user's order (`BasesQueryResult.properties`, obsidian.d.ts @1.10.0).
			// A view with no explicit order yet falls back to the config's own order list; both are the
			// `.base` file's view config per `docs/03` §where-things-live, so neither invents a column.
			order: (): readonly string[] =>
				this.data.properties.length > 0 ? this.data.properties : this.config.getOrder(),
			displayName: (propertyId: string): string | undefined => {
				// BasesViewConfig.getDisplayName(propertyId: BasesPropertyId): string — obsidian.d.ts,
				// @since 1.10.0. It always answers, so "undefined" means "same as the stored name" and the
				// source keeps the real key. A bare name (no source prefix) is not a Bases property id at
				// all, and narrowing to the prefixed form is a check rather than an assertion.
				if (!isBasesPropertyId(propertyId)) {
					return undefined;
				}
				const shown = this.config.getDisplayName(propertyId);
				return shown === '' ? undefined : shown;
			},
			rawValue: (filePath: string, propertyId: string): unknown => {
				// The raw frontmatter is the only place a value can be read *and* written back unchanged; the
				// metadata cache is Obsidian's own parse of it. `FrontMatterCache` is `[key: string]: any`, so
				// this narrows to `unknown` immediately and never trusts the shape.
				const file: TFile | null = this.app.vault.getFileByPath(filePath);
				if (file === null) {
					return undefined;
				}
				const cache = this.app.metadataCache.getFileCache(file);
				const frontmatter: unknown = cache?.frontmatter;
				if (typeof frontmatter !== 'object' || frontmatter === null) {
					return undefined;
				}
				const name = propertyId.includes('.')
					? propertyId.slice(propertyId.indexOf('.') + 1)
					: propertyId;
				return Reflect.get(frontmatter, name);
			},
			config: (key: string): unknown => this.config.get(key),
			setConfig: (key: string, value: string): void => {
				// BasesViewConfig.set(key, value): void — obsidian.d.ts, @since 1.10.0. This is the documented
				// "store configuration data for the view" path, and it travels with the `.base` file.
				this.config.set(key, value);
			},
			watch: (listener: () => void): (() => void) => {
				// The view's own lifecycle *is* the watch: Bases calls `onDataUpdated` on every vault or config
				// change that affects this query, so the source subscribes here rather than to `window`. That is
				// the alternative to a global listener the step's STOP clause asks about: no listener exists to
				// leak, and `dispose()` empties the set.
				this.watchers.add(listener);
				return () => {
					this.watchers.delete(listener);
				};
			},
			createFileForView: async (baseFileName, frontmatterProcessor) => {
				// BasesView.createFileForView(baseFileName?, frontmatterProcessor?): Promise<void> —
				// obsidian.d.ts, @since 1.10.2. Note the declaration's own wording: it *displays the new note
				// menu*, so this is the single-row path, never a bulk one (see adapters/notes/createNote.ts).
				await this.createFileForView(baseFileName, frontmatterProcessor);
			},
		};
	}

	/** BasesView.onDataUpdated(): abstract void — obsidian.d.ts, @since 1.10.0. */
	onDataUpdated(): void {
		for (const notify of [...this.watchers]) {
			notify();
		}
		this.render();
	}

	/** Re-renders the placeholder line from the current snapshot. Cheap: it re-reads what is in memory. */
	render(): void {
		const schema = this.source.getSchema();
		const rows = this.source.getRows();
		const summary = summarize({
			rows,
			fields: schema.fields.map((field) => ({
				id: field.definition.id,
				display: (filePath: string): string =>
					field.descriptor.formatDisplay(
						this.source.getValue(filePath, field.definition.id),
						field.context,
					),
			})),
			lastResult: this.source.lastResult(),
			problems: this.source.problems(),
		});
		this.host.empty();
		this.host.createDiv({ cls: 'tablify-placeholder-status', text: summary.status });
		for (const line of summary.sample) {
			this.host.createDiv({ cls: 'tablify-placeholder-row', text: line });
		}
	}

	/** Called by the plugin when the view closes: release listeners, timers and queued writes. */
	dispose(): void {
		for (const stop of this.cleanup.splice(0, this.cleanup.length)) {
			stop();
		}
		if (this.metadataRef !== null) {
			// Events.offref(ref): void — obsidian.d.ts, @since 0.9.7. Nothing of ours outlives the view.
			this.app.metadataCache.offref(this.metadataRef);
			this.metadataRef = null;
		}
		this.source.dispose();
	}

	/** The source, for the plugin's commands (a debug write path, and the settings tab's diagnostics). */
	get rowSource(): ReturnType<typeof createBasesSource> {
		return this.source;
	}
}
