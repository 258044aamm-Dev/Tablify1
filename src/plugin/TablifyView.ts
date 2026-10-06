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
import { createKeyboardInset } from '../grid/keyboardInset';
import { readHeaderHeight } from '../grid/measure';
import { revealElement } from '../grid/keyboard/focus';
import type { GridViewProps } from '../grid/GridView';
import { createDialogPort } from '../grid/dialogs/port';
import { KeyboardHelpModal } from './help/KeyboardHelpModal';
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
	/**
	 * The keyboard-inset writer (`src/grid/keyboardInset.ts`), or `null` in a DOM-less environment. Owned here
	 * because the host element is the view's, and released in the same `cleanup` pass as everything else.
	 */
	private keyboardInset: ReturnType<typeof createKeyboardInset> | null = null;
	/**
	 * The presentation the grid is rendering with. The view owns it (§P21's pinning rule and the density setting
	 * are both *this view's* answer, not the store's), and a change from the View options dialog lands here.
	 */
	private presentation: { density: 'short' | 'medium' | 'tall'; frozenPrimary: boolean };

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

		/*
		 * The view's own settings come back out of the `.base` sidecar here (step 27). The write path has always
		 * been there — `BasesSource` writes `tablifyViewConfig` on every view-options change — but until this line
		 * existed nothing read it, so closing the base and opening it again reset column order, hidden columns,
		 * grouping and collapsed groups. `docs/03` §Storage puts the view's settings in the `.base`, which only
		 * means anything if a reopened view reads them.
		 */
		this.store = createGridStore({
			source: this.source,
			view: this.source.initialView(),
		});

		/*
		 * The settings the grid's *presentation* needs. Read through the store so a change in the settings tab
		 * reaches an open view.
		 *
		 * The order is the point (step 29): the **view's own** stored presentation wins, then the plugin-wide
		 * setting, then the shipped default. Before this, the view's decision lived only in memory — a density
		 * picked in View options survived until the pane was closed, and the `.base` never learned it, even
		 * though the sidecar write path for the *rest* of the view options has existed since step 19.
		 */
		const stored = this.source.initialPresentation();
		const density =
			stored.density ??
			settings?.get().appearance.defaultRowHeight ??
			DEFAULT_SETTINGS.appearance.defaultRowHeight;
		this.presentation = { density, frozenPrimary: stored.frozenPrimary ?? true };
		if (settings !== undefined) {
			this.cleanup.push(
				settings.subscribe(() => {
					// A settings change moves the *default*; a presentation change made in the View options dialog is
					// the view's own decision while it is open, so this only replaces the field the setting owns.
					this.presentation = {
						...this.presentation,
						density: settings.get().appearance.defaultRowHeight,
					};
					this.remount();
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
			this.root = createRoot(this.host);
			this.root.render(createElement(GridView, this.gridProps()));
		}

		/*
		 * The on-screen keyboard (step 27). `docs/04` §Keyboard and viewport asks for exactly this and no more:
		 * `visualViewport`'s `resize`/`scroll`, **one** CSS variable on the view's own host, and the focused cell
		 * revealed after the inset settles. The token is written on `this.host` rather than on `document.body`
		 * (which is where it is *declared*): an inline value on an ancestor of `.tablify-root` is what `var()`
		 * resolves against, and keeping it on the host means two panes in one window cannot fight over one
		 * number. `registerDomEvent`-style ownership is not available here — this is not a `Component` method —
		 * so the listeners are torn down in `dispose()` with everything else in `cleanup`.
		 */
		if (typeof window !== 'undefined') {
			const viewport =
				typeof window.visualViewport === 'object' && window.visualViewport !== null
					? window.visualViewport
					: null;
			this.keyboardInset = createKeyboardInset({
				host: this.host.style,
				window: { innerHeight: window.innerHeight },
				viewport,
				// The reveal is the grid's **existing** one (`revealElement`: the vertical band, the clamp, the
				// horizontal case, all shared with `Ctrl+End` and the arrow keys). The focused element is looked
				// up here, per call, because the editor is a different input every time: a captured one would be
				// the editor from before the person moved.
				reveal: () => {
					const scroller = this.host.querySelector('.tablify-scroller');
					const active = document.activeElement;
					if (!(scroller instanceof HTMLElement) || !(active instanceof HTMLElement)) {
						return;
					}
					if (!this.host.contains(active)) {
						// A dialog's own field lives outside the host: that is Obsidian's surface, with its own
						// focus trap, and the grid has no business scrolling it.
						return;
					}
					revealElement(scroller, active, readHeaderHeight(this.host));
				},
			});
			this.keyboardInset.start();
			// A focus change is when the reveal matters: the keyboard has not moved yet when the editor opens,
			// and the browser scrolls its own way. Re-syncing on both edges means the reveal runs once after the
			// inset settles, which is the frame `docs/04` asks for.
			const onFocusChange = (): void => {
				this.keyboardInset?.sync();
			};
			this.host.addEventListener('focusin', onFocusChange);
			this.host.addEventListener('focusout', onFocusChange);
			this.cleanup.push(() => {
				this.host.removeEventListener('focusin', onFocusChange);
				this.host.removeEventListener('focusout', onFocusChange);
				this.keyboardInset?.stop();
				this.keyboardInset = null;
			});
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

	/** Re-renders the grid with the current presentation. Cheap: React diffs the props. */
	private remount(): void {
		this.root?.render(createElement(GridView, this.gridProps()));
	}

	/**
	 * The keyboard reference, opened by `F1`/`?` from inside the grid (step 19's key table routes those keys
	 * here) and by the `open-keyboard-help` command in `main.ts`. One surface, two doors, and the grid never
	 * learns what a `Modal` is — it asks a callback, exactly as it does for a new row.
	 */
	private openHelp(): void {
		new KeyboardHelpModal(this.app).open();
	}

	/**
	 * The row actions the grid's menus offer.
	 *
	 * A row is a note (`docs/01`), so every one of these is a **file operation**, which is exactly why the grid
	 * cannot do them (`src/grid/**` may not import `obsidian`) and why they arrive as a port. What this build
	 * wires is the operation that already exists — inserting a row creates a note, the same thing the toolbar's
	 * "New row" does — and the other two are `null`, which the menus render as a disabled item with its reason
	 * rather than a dead click:
	 *
	 *  · **duplicate** needs a filename for the copy (the same template question "New row" answers) and a note
	 *    created from another note's frontmatter;
	 *  · **delete** needs a confirmation dialog and `FileManager.trashFile` rather than `Vault.delete` — *"a failed
	 *    write must never look like a success"* is a promise a deletion keeps by being undoable in the OS, not by
	 *    being silent.
	 *
	 * Both land in step 21, next to the layout harness, because they are the two operations that need a real vault
	 * to be believed.
	 */
	private rowPorts(): {
		readonly onInsertRow: ((at: number) => void) | null;
		readonly onDuplicateRows: ((paths: readonly string[]) => void) | null;
		readonly onDeleteRows: ((paths: readonly string[]) => void) | null;
	} {
		return {
			// `at` is deliberately ignored: a new note's position in the row set is the *source's* answer (Bases
			// orders the query's rows), and a grid that inserted at an index the source did not honour would be
			// telling the person something untrue about their vault. The unsupported half is recorded here.
			onInsertRow: () => {
				void this.createRow();
			},
			onDuplicateRows: null,
			onDeleteRows: null,
		};
	}

	/** The grid's props, in one place: the mount, a presentation change and a settings change all mean this. */
	private gridProps(): GridViewProps {
		return {
			store: this.store,
			presentation: this.presentation,
			initialPaneWidth: this.host.clientWidth,
			onNewRow: () => {
				void this.createRow();
			},
			onHelp: () => {
				this.openHelp();
			},
			dialogs: createDialogPort(this.app),
			rows: this.rowPorts(),
			onPresentation: (patch) => {
				this.presentation = { ...this.presentation, ...patch };
				// Persist the two the sidecar carries; `rowHeight` is not one of them (a density *name* is what
				// a `.base` stores — `src/grid/layout.ts` says why) and a read-only host just refuses.
				const stored = {
					...(patch.density === undefined ? {} : { density: patch.density }),
					...(patch.frozenPrimary === undefined
						? {}
						: { frozenPrimary: patch.frozenPrimary }),
				};
				if (Object.keys(stored).length > 0) {
					this.source.setPresentation(stored);
				}
				this.remount();
			},
		};
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
