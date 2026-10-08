/**
 * `TablifyFileView` — the native workspace for a `.tablify` database.
 *
 * The registry gives each open path one shared session and write queue. Each leaf adds a small
 * `DatabaseStore` projection, so table navigation is local to the pane while document operations
 * and history still belong to the shared database. The R4 grid is a native DOM view over that projection;
 * this file-view shell owns the database/table/view hierarchy and never uses Bases controls.
 *
 * The file view remains responsible for R2's honest failure and recovery paths: unreadable files are
 * read-only, open/restore/navigation do not write, conflicts offer reload or keep-a-copy, and every
 * handle and store subscription is released with the leaf.
 */
import { FileView, Notice } from 'obsidian';
import type { TFile, ViewStateResult, WorkspaceLeaf } from 'obsidian';

import type {
	DatabaseHandle,
	DatabaseStore,
	DatabaseStoreSnapshot,
	RegistryResult,
	SessionRegistry,
	SessionChange,
	SessionState,
} from '../adapters/tablifyFile';
import { createDatabaseStore } from '../adapters/tablifyFile';
import type { IdKind } from '../core/database';
import { NativeDatabaseGrid } from './NativeDatabaseGrid';
import type { NativeGridEnvironment } from './NativeDatabaseGrid';
import type { TablifyLeafState } from './viewState';
import { EMPTY_LEAF_STATE, leafStateOf, readLeafState } from './viewState';

/** The view type id Obsidian associates with `.tablify`. Public contract: never change it after release. */
export const TABLIFY_FILE_VIEW_TYPE = 'tablify-file';

/** The file extension the plugin claims. One extension, one view type. */
export const TABLIFY_FILE_EXTENSION = 'tablify';

/** What the workspace restores for this view: a selection, never document data (step 7). */
export type TablifyFileViewState = TablifyLeafState;

/** The host services the view needs. The plugin supplies them; tests exercise the real host wiring. */
export interface TablifyFileViewHost {
	/** The shared registry: one session per open path, however many panes. */
	readonly registry: SessionRegistry;
	/** Secure, kind-prefixed ids from the plugin's injected Web Crypto source. */
	readonly createId: (kind: IdKind) => string;
	/** Field-formatting context supplied by the plugin composition root. */
	readonly environment: NativeGridEnvironment;
	/** Write ADR-0005's recovery copy. Must refuse a path that already exists. */
	copyDatabase(path: string, text: string): Promise<void>;
}

interface FocusSnapshot {
	readonly key: string;
	readonly selectionStart: number | null;
	readonly selectionEnd: number | null;
}

interface NameEditorState {
	readonly kind: 'table' | 'view';
	readonly draft: string;
	readonly error: string | null;
}

/** A tag-name guard works across windows without relying on the host's optional DOM prototype helper. */
function isHtmlInputElement(element: Element): element is HTMLInputElement {
	return element.localName === 'input';
}

/** The one-line description of a session state, so the panel and the tests agree on the words. */
export function describeState(state: SessionState): string {
	switch (state) {
		case 'clean':
			return 'Saved';
		case 'dirty':
			return 'Unsaved changes';
		case 'external':
			return 'The file changed on disk';
		case 'conflicted':
			return 'Conflict: the file changed on disk while this pane had unsaved edits';
		case 'detached':
			return 'Detached: this pane stopped writing to the file';
		case 'disposed':
			return 'Closed';
	}
}

export class TablifyFileView extends FileView {
	private readonly host: TablifyFileViewHost;
	private readonly nativeGrid: NativeDatabaseGrid;
	private readonly viewSelectionByTable = new Map<string, string | null>();
	private currentHandle: DatabaseHandle | null = null;
	private databaseStore: DatabaseStore | null = null;
	private unsubscribe: (() => void) | null = null;
	private unsubscribeStore: (() => void) | null = null;
	private failure: RegistryResult | null = null;
	private selection: TablifyFileViewState = EMPTY_LEAF_STATE;
	private nameEditor: NameEditorState | null = null;
	/** A preferred focus target for transitions that replace the focused control. */
	private focusControl: string | null = null;
	/** The path this pane was loaded with, so the title is right before `this.file` is assigned. */
	private loadedPath: string | null = null;

	constructor(leaf: WorkspaceLeaf, host: TablifyFileViewHost) {
		super(leaf);
		this.host = host;
		this.nativeGrid = new NativeDatabaseGrid(host.environment);
	}

	getViewType(): string {
		return TABLIFY_FILE_VIEW_TYPE;
	}

	/**
	 * The handle this pane holds, or `null` before a file is loaded and after it is released.
	 * The pane's commands go through the derived database store; tests use this handle to inspect the
	 * shared session and queue without adding a second document copy.
	 */
	handle(): DatabaseHandle | null {
		return this.currentHandle;
	}

	getDisplayText(): string {
		// Obsidian assigns `this.file` when it hands the view a file; the loaded path is the fallback
		// for the first render and for the tests, which drive the hook directly.
		if (this.file !== null) {
			return this.file.basename;
		}
		const path = this.loadedPath;
		if (path === null) {
			return 'Tablify database';
		}
		const name = path.split('/').pop() ?? path;
		const dot = name.lastIndexOf('.');
		return dot === -1 ? name : name.slice(0, dot);
	}

	getIcon(): string {
		return 'table-2';
	}

	/** Obsidian asks this when routing a file: only `.tablify` belongs here. */
	canAcceptExtension(extension: string): boolean {
		return extension === TABLIFY_FILE_EXTENSION;
	}

	/** Workspace state: the selection, so a restored leaf reopens on the same table and view. */
	getState(): Record<string, unknown> {
		return leafStateOf(this.selection);
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		void result;
		if (this.selection.tableId !== null) {
			this.viewSelectionByTable.set(this.selection.tableId, this.selection.viewId);
		}
		this.selection = readLeafState(state);
		if (this.selection.tableId !== null) {
			this.viewSelectionByTable.set(this.selection.tableId, this.selection.viewId);
		}
		const store = this.databaseStore;
		if (store !== null) {
			const snapshot = store.getSnapshot();
			const requested = snapshot.document.tables.find(
				(table) => table.id === this.selection.tableId,
			);
			const table = requested ?? snapshot.document.tables[0];
			if (table !== undefined) {
				store.selectTable(table.id);
			}
			const selected = store.getSnapshot();
			const activeTable = selected.document.tables.find(
				(candidate) => candidate.id === selected.activeTableId,
			);
			const viewExists =
				this.selection.viewId !== null &&
				activeTable?.views.some((view) => view.id === this.selection.viewId) === true;
			this.selection = {
				tableId: selected.activeTableId,
				viewId: viewExists ? this.selection.viewId : null,
			};
			if (selected.activeTableId !== null) {
				this.viewSelectionByTable.set(selected.activeTableId, this.selection.viewId);
			}
		}
		// A restore is a read: it re-renders and writes nothing.
		this.render();
	}

	async onLoadFile(file: TFile): Promise<void> {
		await this.release();
		this.failure = null;
		this.nameEditor = null;
		this.loadedPath = file.path;
		const opened = await this.host.registry.open(file.path);
		if (!opened.ok) {
			this.failure = opened;
			this.render();
			return;
		}
		this.adopt(opened.handle);
	}

	async onUnloadFile(file: TFile): Promise<void> {
		void file;
		await this.release();
	}

	async onRename(file: TFile): Promise<void> {
		// The registry follows renames itself; the leaf only needs its title refreshed.
		void file;
		this.render();
	}

	async onClose(): Promise<void> {
		await this.release();
	}

	/** The reasons the panel can show instead of a document, in the words a person needs. */
	private failureMessage(failure: RegistryResult): string {
		if (failure.ok) {
			return '';
		}
		switch (failure.failure.kind) {
			case 'missing':
				return 'There is no file at this path any more. Nothing was written.';
			case 'invalid':
				return 'This file is not readable as a Tablify database. Nothing was written.';
			case 'unsupported-version':
				return 'This file was written by a newer version of the plugin. Nothing was written.';
			case 'exists':
				return 'Something already exists at that path.';
			case 'create-failed':
				return failure.failure.message;
			case 'disposed':
				return 'The plugin is shutting down.';
		}
	}

	private adopt(handle: DatabaseHandle): void {
		this.currentHandle = handle;
		const store = createDatabaseStore({
			session: handle.session,
			queue: handle.queue,
			...(this.selection.tableId === null ? {} : { initialTableId: this.selection.tableId }),
		});
		this.databaseStore = store;
		this.reconcileSelection(store.getSnapshot());
		this.unsubscribeStore = store.subscribe(() => {
			this.onStoreChange();
		});
		this.unsubscribe = handle.session.subscribe((change: SessionChange) => {
			this.onSessionChange(change);
		});
		this.render();
	}

	private onStoreChange(): void {
		const store = this.databaseStore;
		if (store === null) {
			return;
		}
		this.reconcileSelection(store.getSnapshot());
		this.render();
	}

	/** Keep the workspace's view selection scoped to the table the per-pane store currently projects. */
	private reconcileSelection(snapshot: DatabaseStoreSnapshot): void {
		if (this.selection.tableId !== snapshot.activeTableId) {
			if (this.selection.tableId !== null) {
				this.viewSelectionByTable.set(this.selection.tableId, this.selection.viewId);
			}
			const table = snapshot.document.tables.find(
				(candidate) => candidate.id === snapshot.activeTableId,
			);
			const remembered =
				snapshot.activeTableId === null
					? null
					: (this.viewSelectionByTable.get(snapshot.activeTableId) ?? null);
			const viewExists =
				remembered !== null && table?.views.some((view) => view.id === remembered) === true;
			this.selection = {
				tableId: snapshot.activeTableId,
				viewId: viewExists ? remembered : null,
			};
			if (snapshot.activeTableId !== null && !viewExists) {
				this.viewSelectionByTable.set(snapshot.activeTableId, null);
			}
			return;
		}
		const table = snapshot.document.tables.find(
			(candidate) => candidate.id === snapshot.activeTableId,
		);
		if (
			this.selection.viewId !== null &&
			!table?.views.some((view) => view.id === this.selection.viewId)
		) {
			this.selection = { tableId: snapshot.activeTableId, viewId: null };
			if (snapshot.activeTableId !== null) {
				this.viewSelectionByTable.set(snapshot.activeTableId, null);
			}
		}
	}

	private onSessionChange(change: SessionChange): void {
		if (change.kind === 'conflict') {
			new Notice('Tablify: the file changed on disk. Reload from disk or keep a copy.');
		} else if (change.kind === 'write-failed') {
			new Notice(`Tablify: the change is still unsaved — ${change.message}`);
		}
		// The DatabaseStore subscription renders the new session snapshot exactly once.
	}

	private async release(): Promise<void> {
		const unsubscribeStore = this.unsubscribeStore;
		this.unsubscribeStore = null;
		if (unsubscribeStore !== null) {
			unsubscribeStore();
		}
		const store = this.databaseStore;
		this.databaseStore = null;
		store?.dispose();

		const unsubscribe = this.unsubscribe;
		this.unsubscribe = null;
		if (unsubscribe !== null) {
			unsubscribe();
		}
		const handle = this.currentHandle;
		this.currentHandle = null;
		if (handle !== null) {
			await handle.release();
		}
	}

	/** Reload means "adopt the disk text". Only a click reaches here; a restore never does. */
	private async reloadFromDisk(): Promise<void> {
		this.nativeGrid.cancelPending();
		const handle = this.currentHandle;
		if (handle === null) {
			return;
		}
		const reloaded = await handle.session.reload();
		if (!reloaded.ok) {
			new Notice('Tablify: the file on disk could not be read; keeping the current text.');
		}
		this.render();
	}

	/** Keep a copy: serialize what this pane holds and write it somewhere new (ADR-0005). */
	private async keepAsCopy(): Promise<void> {
		if (!this.commitGridEditBeforeNavigation()) {
			return;
		}
		const handle = this.currentHandle;
		if (handle === null) {
			return;
		}
		const copy = handle.session.keepAsCopy();
		try {
			await this.host.copyDatabase(copy.suggestedPath, copy.text);
			new Notice(`Tablify: saved a copy as "${copy.suggestedPath}".`);
		} catch (error) {
			new Notice(
				`Tablify: could not save the copy — ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		this.render();
	}

	private captureFocus(root: HTMLElement): FocusSnapshot | null {
		const active = root.ownerDocument.activeElement;
		if (active === null || !root.contains(active)) {
			return null;
		}
		const key = active.getAttribute('data-focus-key');
		if (key === null) {
			return null;
		}
		if (isHtmlInputElement(active)) {
			return {
				key,
				selectionStart: active.selectionStart,
				selectionEnd: active.selectionEnd,
			};
		}
		return { key, selectionStart: null, selectionEnd: null };
	}

	private restoreFocus(
		root: HTMLElement,
		preferredKey: string | null,
		previous: FocusSnapshot | null,
	): void {
		const key = preferredKey ?? previous?.key ?? null;
		if (key !== null) {
			const controls = Array.from(root.querySelectorAll<HTMLElement>('[data-focus-key]'));
			const target =
				controls.find((element) => element.getAttribute('data-focus-key') === key) ??
				(key === 'native-grid-editor'
					? controls.find(
							(element) => element.getAttribute('data-focus-key') === 'native-grid',
						)
					: undefined);
			if (target !== undefined) {
				target.focus();
				if (
					isHtmlInputElement(target) &&
					(previous?.key === key || preferredKey === 'name-input')
				) {
					const start = previous?.selectionStart ?? target.value.length;
					const end = previous?.selectionEnd ?? start;
					target.setSelectionRange(start, end);
				}
			}
		}
		this.focusControl = null;
	}

	/** Draw the whole panel. Reads the store snapshot; never dispatches from a render path. */
	render(): void {
		const root = this.containerEl;
		const previousFocus = this.captureFocus(root);
		const preferredFocus = this.focusControl;
		root.empty();
		const panel = root.createDiv({ cls: 'tablify-file-view' });

		if (this.failure !== null) {
			panel.createDiv({ cls: 'tablify-file-title', text: this.getDisplayText() });
			this.renderFailure(panel, this.failure);
			this.restoreFocus(root, preferredFocus, previousFocus);
			return;
		}
		const handle = this.currentHandle;
		const store = this.databaseStore;
		if (handle === null || store === null) {
			panel.createDiv({ cls: 'tablify-file-title', text: this.getDisplayText() });
			panel.createDiv({
				cls: 'tablify-file-empty',
				text: 'No database is open in this pane.',
			});
			this.restoreFocus(root, preferredFocus, previousFocus);
			return;
		}
		this.renderWorkspace(panel, store, store.getSnapshot());
		this.restoreFocus(root, preferredFocus, previousFocus);
	}

	private renderFailure(
		panel: ReturnType<HTMLElement['createDiv']>,
		failure: RegistryResult,
	): void {
		panel.createDiv({ cls: 'tablify-file-status', text: this.failureMessage(failure) });
		if (
			!failure.ok &&
			(failure.failure.kind === 'invalid' || failure.failure.kind === 'unsupported-version')
		) {
			const findings = panel.createDiv({ cls: 'tablify-file-findings' });
			for (const error of failure.failure.errors.slice(0, 10)) {
				findings.createDiv({
					cls: 'tablify-file-finding',
					text: `${error.code}: ${error.message}`,
				});
			}
		}
	}

	private renderWorkspace(
		panel: ReturnType<HTMLElement['createDiv']>,
		store: DatabaseStore,
		snapshot: DatabaseStoreSnapshot,
	): void {
		panel.addClass('tablify-root');
		panel.addClass('tablify-native-workspace');
		const titleRow = panel.createDiv({ cls: 'tablify-native-header' });
		const titleBlock = titleRow.createDiv({ cls: 'tablify-native-title-block' });
		titleBlock.createEl('h1', {
			cls: 'tablify-native-database-title',
			text: snapshot.document.name,
		});
		const rowCount = snapshot.document.tables.reduce(
			(total, table) => total + table.rows.length,
			0,
		);
		titleBlock.createDiv({
			cls: 'tablify-native-summary',
			text: `${String(snapshot.document.tables.length)} tables · ${String(rowCount)} rows`,
		});

		const current = snapshot.activeTable?.table ?? null;
		const controls = titleRow.createDiv({ cls: 'tablify-native-selectors' });
		const tableLabel = controls.createEl('label', { cls: 'tablify-native-control' });
		tableLabel.createSpan({ text: 'Table' });
		const tableSelect = tableLabel.createEl('select', { cls: 'tablify-native-select' });
		tableSelect.setAttribute('aria-label', 'Table');
		tableSelect.setAttribute('data-focus-key', 'table-select');
		for (const table of snapshot.document.tables) {
			const option = tableSelect.createEl('option', {
				text: `${table.name} — ${String(table.rows.length)} rows`,
			});
			option.value = table.id;
		}
		if (current !== null) {
			tableSelect.value = current.id;
		}
		tableSelect.disabled = snapshot.document.tables.length === 0;
		tableSelect.onchange = (): void => {
			this.selectTable(tableSelect.value);
		};
		this.makeButton(controls, 'Create table', 'create-table', () => {
			this.openNameEditor('table');
		});

		const viewLabel = controls.createEl('label', { cls: 'tablify-native-control' });
		viewLabel.createSpan({ text: 'View' });
		const viewSelect = viewLabel.createEl('select', { cls: 'tablify-native-select' });
		viewSelect.setAttribute('aria-label', 'Saved view');
		viewSelect.setAttribute('data-focus-key', 'view-select');
		const defaultOption = viewSelect.createEl('option', { text: 'Default view' });
		defaultOption.value = '';
		for (const view of current?.views ?? []) {
			const option = viewSelect.createEl('option', { text: view.name });
			option.value = view.id;
		}
		viewSelect.value = this.selection.viewId ?? '';
		viewSelect.disabled = current === null;
		viewSelect.onchange = (): void => {
			this.selectView(viewSelect.value === '' ? null : viewSelect.value);
		};
		this.makeButton(
			controls,
			'Create view',
			'create-view',
			() => {
				this.openNameEditor('view');
			},
			current === null,
		);

		const toolbar = panel.createDiv({ cls: 'tablify-toolbar tablify-native-toolbar' });
		toolbar.setAttribute('role', 'group');
		toolbar.setAttribute('aria-label', 'Database actions');
		this.makeButton(
			toolbar,
			'Undo',
			'undo',
			() => {
				if (this.commitGridEditBeforeNavigation()) {
					this.databaseStore?.undo();
				}
			},
			!snapshot.history.canUndo,
		);
		this.makeButton(
			toolbar,
			'Redo',
			'redo',
			() => {
				if (this.commitGridEditBeforeNavigation()) {
					this.databaseStore?.redo();
				}
			},
			!snapshot.history.canRedo,
		);
		const currentSummary = toolbar.createSpan({
			cls: 'tablify-native-current-table',
			text:
				current === null
					? 'No table selected'
					: `${current.name} · ${String(current.rows.length)} rows · ${String(current.fields.length)} fields`,
		});
		currentSummary.setAttribute('aria-live', 'polite');
		this.makeButton(toolbar, 'Reload from disk', 'reload', () => {
			void this.reloadFromDisk();
		});
		if (snapshot.sessionState === 'conflicted') {
			this.makeButton(toolbar, 'Keep a copy', 'keep-copy', () => {
				void this.keepAsCopy();
			});
		}

		if (this.nameEditor !== null) {
			this.renderNameEditor(panel, this.nameEditor);
		}

		const grid = panel.createDiv({ cls: 'tablify-grid-area tablify-native-grid' });
		this.nativeGrid.render(grid, store, snapshot, this.selection.viewId);

		const status = panel.createDiv({ cls: 'tablify-statusbar tablify-native-status' });
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		status.setAttribute('aria-atomic', 'true');
		status.setText(
			snapshot.writeError === null
				? describeState(snapshot.sessionState)
				: `Not saved: ${snapshot.writeError}`,
		);
	}

	private makeButton(
		container: HTMLElement,
		label: string,
		focusKey: string,
		onClick: () => void,
		disabled = false,
	): HTMLButtonElement {
		const button = container.createEl('button', {
			cls: 'tablify-native-button',
			text: label,
		});
		button.type = 'button';
		button.disabled = disabled;
		button.setAttribute('data-focus-key', focusKey);
		button.onclick = onClick;
		return button;
	}

	private commitGridEditBeforeNavigation(): boolean {
		if (this.nativeGrid.commitPending()) {
			return true;
		}
		this.focusControl = 'native-grid-editor';
		this.render();
		return false;
	}

	private selectTable(tableId: string): void {
		const store = this.databaseStore;
		if (store === null || !this.commitGridEditBeforeNavigation()) {
			return;
		}
		const previousTableId = store.getSnapshot().activeTableId;
		if (previousTableId !== null) {
			this.viewSelectionByTable.set(previousTableId, this.selection.viewId);
		}
		const selected = store.selectTable(tableId);
		if (!selected.ok) {
			new Notice(`Tablify: ${selected.message}`);
			return;
		}
		if (!selected.changed) {
			this.selection = {
				tableId,
				viewId: this.viewSelectionByTable.get(tableId) ?? null,
			};
			this.render();
		}
	}

	private selectView(viewId: string | null): void {
		const tableId = this.databaseStore?.getSnapshot().activeTableId ?? null;
		const table = this.databaseStore
			?.getSnapshot()
			.document.tables.find((candidate) => candidate.id === tableId);
		if (
			(viewId !== null && !table?.views.some((view) => view.id === viewId)) ||
			!this.commitGridEditBeforeNavigation()
		) {
			return;
		}
		this.selection = { tableId, viewId };
		if (tableId !== null) {
			this.viewSelectionByTable.set(tableId, viewId);
		}
		this.render();
	}

	private openNameEditor(kind: 'table' | 'view'): void {
		if (!this.commitGridEditBeforeNavigation()) {
			return;
		}
		this.nameEditor = { kind, draft: '', error: null };
		this.focusControl = 'name-input';
		this.render();
	}

	private cancelNameEditor(): void {
		const kind = this.nameEditor?.kind;
		this.nameEditor = null;
		this.focusControl = kind === 'view' ? 'create-view' : 'create-table';
		this.render();
	}

	private renderNameEditor(
		panel: ReturnType<HTMLElement['createDiv']>,
		editor: NameEditorState,
	): void {
		const section = panel.createDiv({ cls: 'tablify-native-name-editor' });
		section.setAttribute('role', 'group');
		section.setAttribute('aria-label', `Create ${editor.kind}`);
		const heading = editor.kind === 'table' ? 'Create table' : 'Create saved view';
		section.createEl('h2', { text: heading });
		const form = section.createEl('form', { cls: 'tablify-native-name-form' });
		form.setAttribute('aria-label', heading);
		const label = form.createEl('label', { cls: 'tablify-native-control' });
		label.createSpan({ text: 'Name' });
		const input = label.createEl('input', {
			cls: 'tablify-native-name-input',
			type: 'text',
		});
		input.value = editor.draft;
		input.required = true;
		input.setAttribute('aria-label', `${editor.kind === 'table' ? 'Table' : 'View'} name`);
		input.setAttribute('data-focus-key', 'name-input');
		input.oninput = (): void => {
			const current = this.nameEditor;
			if (current !== null) {
				this.nameEditor = { ...current, draft: input.value, error: null };
			}
		};
		form.onsubmit = (event: SubmitEvent): void => {
			event.preventDefault();
			this.commitName(input.value);
		};
		const actions = form.createDiv({ cls: 'tablify-native-name-actions' });
		const submit = actions.createEl('button', {
			cls: 'tablify-native-button',
			text: heading,
		});
		submit.type = 'submit';
		submit.setAttribute('data-focus-key', 'name-submit');
		this.makeButton(actions, 'Cancel', 'name-cancel', () => {
			this.cancelNameEditor();
		});
		if (editor.error !== null) {
			const error = section.createDiv({
				cls: 'tablify-native-name-error',
				text: editor.error,
			});
			error.setAttribute('role', 'alert');
		}
	}

	private commitName(rawName: string): void {
		const editor = this.nameEditor;
		const store = this.databaseStore;
		if (editor === null || store === null) {
			return;
		}
		const name = rawName.trim();
		if (name === '') {
			this.nameEditor = {
				...editor,
				draft: rawName,
				error: 'Enter a name before continuing.',
			};
			this.render();
			return;
		}
		let entityId: string;
		try {
			entityId = this.host.createId(editor.kind);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.nameEditor = {
				...editor,
				draft: rawName,
				error: `A secure id could not be generated: ${detail}`,
			};
			this.render();
			return;
		}

		if (editor.kind === 'table') {
			const result = store.dispatch(
				{ kind: 'create-table', tableId: entityId, name },
				`Create table: ${name}`,
			);
			if (!result.ok) {
				this.nameEditor = { ...editor, draft: rawName, error: result.message };
				this.render();
				return;
			}
			this.nameEditor = null;
			this.focusControl = 'table-select';
			store.selectTable(entityId);
			this.selection = { tableId: entityId, viewId: null };
			this.viewSelectionByTable.set(entityId, null);
			this.render();
			return;
		}

		const tableId = store.getSnapshot().activeTableId;
		if (tableId === null) {
			this.nameEditor = {
				...editor,
				draft: rawName,
				error: 'Create a table before adding a saved view.',
			};
			this.render();
			return;
		}
		const result = store.dispatch(
			{ kind: 'create-view', tableId, viewId: entityId, name },
			`Create view: ${name}`,
		);
		if (!result.ok) {
			this.nameEditor = { ...editor, draft: rawName, error: result.message };
			this.render();
			return;
		}
		this.nameEditor = null;
		this.selection = { tableId, viewId: entityId };
		this.viewSelectionByTable.set(tableId, entityId);
		this.focusControl = 'view-select';
		this.render();
	}
}
