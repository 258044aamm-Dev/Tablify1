/**
 * The real Bases view: a `GridView` over a `BasesSource`, mounted once and then driven by the store.
 *
 * **What changed in step 17.** Steps 12–16 built the data path and rendered a five-line placeholder, on
 * purpose: the grid did not exist yet. This file is now the thin half — it owns the lifecycle and the
 * Obsidian APIs, and renders `GridView` with a store. There is no per-change `render()` any more: React
 * subscribes to the store's own channels, so a keystroke never walks up to this class.
 *
 * **The one measurement that happens before the first paint.** `initialPaneWidth` is read from the container
 * here, synchronously, and handed to `GridView`. That is what stops the first frame from painting a pinned
 * column in a 389 px pane and removing it on the second frame; and it is why pinning lives in one derived
 * value rather than in a media query — a media query answers for the *window*, and the question is about the
 * *pane*.
 *
 * **The APIs this file touches, and nothing else does.** `BasesView`, `queryController`, `config`,
 * `data`, `onDataUpdated()`, `createFileForView()`, `fileManager.processFrontMatter`
 * (`@since 1.4.4`), `metadataCache.on('changed')` and `offref`. All of them are read from `obsidian.d.ts`
 * @ 1.13.1 and cross-checked against `spike/bases-path/FINDINGS.md`; `BasesView` still declares no
 * `containerEl`, which is why the factory's second argument is kept here.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
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
import { GridView } from '../grid/GridView';
import { createGridStore } from '../grid/store/store';
import type { GridStore } from '../grid/store/types';
import { DEFAULT_SETTINGS } from './settings/schema';
import type { SettingsStore } from './settings/save';

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

/** The heading the placeholder used to show. Kept as a constant because step 12's tests assert on it. */
export const TABLIFY_VIEW_STATUS_PREFIX = 'Tablify — ';

/** Everything the placeholder needed to render one line of truth. */
export type ViewSummary = {
	readonly rows: number;
	readonly fields: number;
	readonly sample: readonly string[];
	readonly status: string;
};

/**
 * The summary line the view *would* show — still a pure function, and still the thing a status bar or a
 * diagnostics dump can ask for. The grid itself does not use it any more (it renders cells), but the shape
 * stays because it is the honest answer to "what does this view hold?" without a DOM.
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

/** One sentence about the last thing that happened. Never empty, so a caller always says something. */
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
 * The view. Bases calls `onDataUpdated()` whenever the query result or the config changes; the source hears
 * it (it subscribed through the host's own `watch`), the store re-queries, and React re-renders whatever the
 * change actually touched.
 */
export class TablifyView extends BasesView {
	/** BasesView.type: abstract string — obsidian.d.ts, @since 1.10.0. Must equal the registered id. */
	readonly type: string;

	/** The container the factory was handed. `BasesView` declares no `containerEl`; see the file header. */
	private readonly containerEl: HTMLElement;

	private readonly host: HTMLElement;
	private readonly source: ReturnType<typeof createBasesSource>;
	private readonly store: GridStore;
	private readonly root: Root | null = null;
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
		/** The plugin's settings. Optional so a view can be built without them (and so step 12's tests, which
		 * construct one directly, keep working): the defaults are what a fresh install would use anyway. */
		settings?: SettingsStore,
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

		this.store = createGridStore({ source: this.source });

		// The settings the grid's *presentation* needs. Read through the store so a change in the settings tab
		// reaches an open view; `density` is the only one the grid takes today (step 19 adds the rest).
		const density =
			settings?.get().appearance.defaultRowHeight ??
			DEFAULT_SETTINGS.appearance.defaultRowHeight;
		const presentation = { density };
		if (settings !== undefined) {
			this.cleanup.push(
				settings.subscribe(() => {
					this.remount({
						density: settings.get().appearance.defaultRowHeight,
					});
				}),
			);
		}

		/**
		 * Mounting is guarded, and the guard is honest: a DOM-less environment (the unit project) has no
		 * `document`, and a view that cannot mount still has to exist without throwing — the test that
		 * constructs one asserts exactly that.
		 */
		if (typeof document !== 'undefined') {
			// Measured before the first paint, on purpose (step 17 item 6): the first frame is already windowed
			// and already knows whether this pane pins its primary column.
			const paneWidth = this.host.clientWidth;
			this.root = createRoot(this.host);
			this.root.render(
				createElement(GridView, {
					store: this.store,
					presentation,
					initialPaneWidth: paneWidth,
					onNewRow: () => {
						void this.createRow();
					},
				}),
			);
		}

		this.cleanup.push(
			this.source.subscribe(() => {
				// The store subscribes to the source itself; this keeps the two halves in step, and keeps the
				// DOM-less placeholder current after a write.
				this.store.refresh();
				if (this.root === null) {
					this.render();
				}
			}),
		);

		/**
		 * External changes. The step's contract for `subscribe` is "the view's data-update **and** vault
		 * metadata changes that touch a file in the row set", and this is that second half: the app's own
		 * `MetadataCache.on('changed')` event, filtered to the rows this view is showing. It is **not** a
		 * `window` listener — the emitter is owned by the app and the ref is released in `dispose()`.
		 * `typeof … === 'function'` guards the app doubles in tests, which model a vault and a cache but not an
		 * event emitter.
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
				// source keeps the real key.
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
				// BasesViewConfig.set(key, value): void — obsidian.d.ts, @since 1.10.0.
				this.config.set(key, value);
			},
			watch: (listener: () => void): (() => void) => {
				// The view's own lifecycle *is* the watch: Bases calls `onDataUpdated` on every vault or config
				// change that affects this query, so the source subscribes here rather than to `window`.
				this.watchers.add(listener);
				return () => {
					this.watchers.delete(listener);
				};
			},
			createFileForView: async (baseFileName, frontmatterProcessor) => {
				// BasesView.createFileForView(baseFileName?, frontmatterProcessor?): Promise<void> —
				// obsidian.d.ts, @since 1.10.2. The declaration's own wording is that it *displays the new note
				// menu*, so this is the single-row path, never a bulk one.
				await this.createFileForView(baseFileName, frontmatterProcessor);
			},
		};
	}

	/**
	 * "New row" opens Bases' own new-note menu (its declaration says so: *displays the new note menu*), and
	 * the row arrives the way every other row does — the vault changes, Bases reports it, the source
	 * refreshes. The grid never invents a file path, and it never shows a row without one.
	 *
	 * This is deliberately *not* a bulk path; `adapters/notes/createNote.ts` is what an import uses.
	 */
	private async createRow(): Promise<void> {
		await this.createFileForView();
	}

	/** BasesView.onDataUpdated(): abstract void — obsidian.d.ts, @since 1.10.0. */
	onDataUpdated(): void {
		for (const notify of [...this.watchers]) {
			notify();
		}
		// The React tree subscribes to the store itself, so this is the *data* half. The placeholder half is
		// the DOM-less path: without a `document` there is no React root, and something still has to say what
		// this view holds — that is `render()` below.
		this.store.refresh();
		if (this.root === null) {
			this.render();
		}
	}

	/**
	 * The placeholder: one line of truth and up to three sample rows, drawn with Obsidian's own DOM helpers.
	 * It survives because it is the honest answer in an environment without a DOM (the unit project), and
	 * because step 12's contract — "the view says what it holds" — is worth keeping even once the grid exists.
	 */
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

	/** Re-renders the grid with a new presentation (a settings change). Cheap: React diffs the props. */
	private remount(presentation: { readonly density: 'short' | 'medium' | 'tall' }): void {
		this.root?.render(
			createElement(GridView, {
				store: this.store,
				presentation,
				initialPaneWidth: this.host.clientWidth,
				onNewRow: () => {
					void this.createRow();
				},
			}),
		);
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
		this.root?.unmount();
		this.store.dispose();
		this.source.dispose();
	}

	/** The source, for the plugin's commands (a debug write path, and the settings tab's diagnostics). */
	get rowSource(): ReturnType<typeof createBasesSource> {
		return this.source;
	}

	/** The store, for the same callers: a command with no open view is not a command this plugin offers. */
	get gridStore(): GridStore {
		return this.store;
	}
}
