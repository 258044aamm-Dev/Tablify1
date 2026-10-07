/**
 * `TablifyFileView` — R2 step 6: the Obsidian-native view a `.tablify` file opens in.
 *
 * This replaces the Bases-backed grid view as the *file* half of the refactor: the extension is
 * registered by the plugin (`main.ts`), Obsidian routes a `.tablify` file here, and the view asks the
 * shared registry (`registry.ts`) for the handle to that path's session. Two leaves on one file get
 * the same session, so nothing here can clobber a newer revision — that is the registry's contract,
 * and this view is one more client of it.
 *
 * What the view does in R2, deliberately, and what it does not:
 *
 *   - it renders the **document**, not a grid: name, table list with counts, the parse findings, and
 *     the session state. The editable grid arrives in R4; a view that only reads cannot lie about
 *     editing, and this one is honest about being read-only for now.
 *   - it **never writes on open, focus, rename or restore**. Opening a file reads it; the only two
 *     paths that write are the user pressing "Reload from disk" (which adopts the disk text) and
 *     "Keep a copy" (ADR-0005's escape hatch, written to a *new* path).
 *   - a file that cannot be read as a database gets a **read-only panel that says why**, never a
 *     blank surface: `missing`, `invalid` (with the parser's findings) and `unsupported-version` are
 *     three different messages, and none of them touches the file.
 *   - the workspace remembers which table was selected through `getState`/`setState` (step 7's
 *     policy: selection is workspace state, never document data). `setState` never writes.
 *
 * Listener discipline: the view subscribes to the session while it holds a handle and unsubscribes
 * when it releases it, so closing a leaf leaves no writer, no timer and no callback behind.
 */
import { FileView, Notice } from 'obsidian';
import type { TFile, ViewStateResult, WorkspaceLeaf } from 'obsidian';

import type { DatabaseHandle, RegistryResult, SessionRegistry } from '../adapters/tablifyFile';
import type { SessionChange, SessionState } from '../adapters/tablifyFile';

/** The view type id Obsidian associates with `.tablify`. Public contract: never change it after release. */
export const TABLIFY_FILE_VIEW_TYPE = 'tablify-file';

/** The file extension the plugin claims. One extension, one view type. */
export const TABLIFY_FILE_EXTENSION = 'tablify';

/** What the workspace restores for this view: a selection, never document data (step 7). */
export interface TablifyFileViewState {
	readonly tableId: string | null;
}

/** The two host services the view needs. The plugin supplies both; tests supply fakes. */
export interface TablifyFileViewHost {
	/** The shared registry: one session per open path, however many panes. */
	readonly registry: SessionRegistry;
	/** Write ADR-0005's recovery copy. Must refuse a path that already exists. */
	copyDatabase(path: string, text: string): Promise<void>;
}

/** Read a workspace state object into the selection. Unknown shapes restore as "nothing selected". */
export function readViewState(state: unknown): TablifyFileViewState {
	if (typeof state === 'object' && state !== null) {
		const candidate: { tableId?: unknown } = state;
		if (typeof candidate.tableId === 'string') {
			return { tableId: candidate.tableId };
		}
	}
	return { tableId: null };
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
	private currentHandle: DatabaseHandle | null = null;
	private unsubscribe: (() => void) | null = null;
	private failure: RegistryResult | null = null;
	private selection: TablifyFileViewState = { tableId: null };
	/** The path this pane was loaded with, so the title is right before `this.file` is assigned. */
	private loadedPath: string | null = null;

	constructor(leaf: WorkspaceLeaf, host: TablifyFileViewHost) {
		super(leaf);
		this.host = host;
	}

	getViewType(): string {
		return TABLIFY_FILE_VIEW_TYPE;
	}

	/**
	 * The handle this pane holds, or `null` before a file is loaded and after it is released.
	 * The pane's own UI reads the document and dispatches commands through it (R4); tests use it to
	 * put the pane into a state a read-only panel cannot reach on its own.
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

	/** Workspace state: the selection, so a restored leaf reopens on the same table. */
	getState(): Record<string, unknown> {
		return { tableId: this.selection.tableId };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		void result;
		this.selection = readViewState(state);
		// A restore is a read: it re-renders and writes nothing.
		this.render();
	}

	async onLoadFile(file: TFile): Promise<void> {
		await this.release();
		this.failure = null;
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
		this.unsubscribe = handle.session.subscribe((change: SessionChange) => {
			this.onSessionChange(change);
		});
		this.render();
	}

	private onSessionChange(change: SessionChange): void {
		this.render();
		if (change.kind === 'conflict') {
			new Notice('Tablify: the file changed on disk. Reload from disk or keep a copy.');
		}
	}

	private async release(): Promise<void> {
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

	/** Draw the whole panel. Idempotent: a render is a read of the current handle and nothing else. */
	render(): void {
		const root = this.containerEl;
		root.empty();
		const panel = root.createDiv({ cls: 'tablify-file-view' });
		panel.createDiv({ cls: 'tablify-file-title', text: this.getDisplayText() });

		if (this.failure !== null) {
			this.renderFailure(panel, this.failure);
			return;
		}
		const handle = this.currentHandle;
		if (handle === null) {
			panel.createDiv({
				cls: 'tablify-file-empty',
				text: 'No database is open in this pane.',
			});
			return;
		}
		this.renderDocument(panel, handle);
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

	private renderDocument(
		panel: ReturnType<HTMLElement['createDiv']>,
		handle: DatabaseHandle,
	): void {
		const document = handle.session.getDocument();
		const state = handle.session.getState();
		const status = panel.createDiv({ cls: 'tablify-file-status', text: describeState(state) });
		status.setAttribute('data-state', state);

		panel.createDiv({ cls: 'tablify-file-database', text: document.name });
		const rowCount = document.tables.reduce((total, table) => total + table.rows.length, 0);
		panel.createDiv({
			cls: 'tablify-file-summary',
			text: `${String(document.tables.length)} tables · ${String(rowCount)} rows`,
		});

		const list = panel.createDiv({ cls: 'tablify-file-tables' });
		for (const table of document.tables) {
			const selected = table.id === this.selection.tableId ? ' (selected)' : '';
			list.createDiv({
				cls: 'tablify-file-table',
				text: `${table.name} — ${String(table.fields.length)} fields, ${String(table.rows.length)} rows${selected}`,
			});
		}

		const actions = panel.createDiv({ cls: 'tablify-file-actions' });
		const reload = actions.createEl('button', {
			cls: 'tablify-file-reload',
			text: 'Reload from disk',
		});
		reload.onclick = (): void => {
			void this.reloadFromDisk();
		};
		if (state === 'conflicted') {
			const keep = actions.createEl('button', {
				cls: 'tablify-file-keep-copy',
				text: 'Keep a copy',
			});
			keep.onclick = (): void => {
				void this.keepAsCopy();
			};
		}
	}
}
