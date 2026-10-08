/**
 * The composition root for sync: **the one file that knows about the vault, the token, the link file and the
 * client at the same time.**
 *
 * Nothing above it in this folder imports the provider client, `requestUrl` or the vault; nothing below it in
 * `src/sync/` imports Obsidian. This is the seam, and it is deliberately the only one — a second seam is how a port stops
 * being a port.
 *
 * ## The dynamic import, and what it is honestly worth
 *
 * `src/plugin/main.ts` does **not** import this module. It imports the command text and calls
 * `await import('./sync/host')` inside the command handler, so this module — and the client under it — loads the
 * first time a person asks for sync. Two caveats, both measured in this project rather than assumed:
 *
 *   · **`esbuild` in CJS mode inlines dynamic chunks** — step 24 measured +81.9 KB raw / +23.2 KB gzip for the
 *     lazily imported writer, and `tests/unit/startup.test.ts` asserts the same thing about the client here (its
 *     metafile check proves the *graph* is lazy; the byte count proves the *bundle* is not). So in the shipped
 *     `main.js` this import does **not** defer the bytes: what it buys today is a module that is not evaluated
 *     until somebody asks for it, plus a single entry point the tests can assert on. Lift the CJS constraint and
 *     the same code splits for free.
 *   · **opening a linked view loads nothing either.** `docs/01` §Sync UX: sync is manual, and the one thing that
 *     happens on open is `updateStatus`, which reads the **link file** and writes a status-bar string. It does not
 *     touch the network and does not compare values — *"check for changes on open"* is a read-only comparison a
 *     person enables, and it is a later step's job, not this badge's.
 *
 * ## What "the vault" means for each thing
 *
 * | Thing | Where it comes from |
 * |---|---|
 * | the local rows and values | the open `TablifyView` — its grid store when mounted, its `BasesSource` when not |
 * | the token | `SecretStorage` through `plugin/settings/secrets.ts` — never `data.json` |
 * | the link file | `.tablify/links/<hash>.json`, through the file port the caller injects |
 * | the remote side | `createAirtableClient` over Obsidian's `requestUrl` |
 */
import { requestUrl } from 'obsidian';

import { createLinkStore, describeLink, LINK_FOLDER } from '../../sync/LinkStore';
import type { LinkDocument, LinkTarget } from '../../sync/LinkStore';
import { createRequestUrlTransport } from '../../sync/airtable/transport';
import { createAirtableClient } from '../../sync/airtable/client';
import { failureText, planSync, runSync } from '../../sync/pullPush';
import type { SyncLocalPort } from '../../sync/pullPush';
import { resolveFieldMap } from '../../sync/SyncTarget';
import type { UnmappedField } from '../../sync/SyncTarget';
import { readToken, secretHostOf, writeToken } from '../settings/secrets';
import { gridLocalPort, sourceLocalPort } from './local';
import { SyncDialog } from './SyncPanel';
import { ConflictReviewDialog } from './ConflictReview';
import type { MappingRow, SyncPanelHost, SyncPanelState } from './SyncPanel';
import type { ResolutionBook } from '../../sync/diff';
import type { TablifyView } from '../TablifyView';

/** The vault's text files, as this module needs them. `DataAdapter` satisfies it; a map satisfies it in a test. */
export type SyncFilePort = {
	readonly read: (path: string) => Promise<string | null>;
	readonly write: (path: string, text: string) => Promise<void>;
};

export type SyncHostOptions = {
	/** The view a sync is about: the active one, or `null` when the focused pane is not a Tablify grid. */
	readonly activeView: () => TablifyView | null;
	readonly files: SyncFilePort;
	/** Where the badge goes. Injected so a test reads a string instead of the status bar. */
	readonly setStatus: (text: string) => void;
	/** Says something to the person. Injected so a test does not need a real `Notice`. */
	readonly notify: (message: string) => void;
};

/** The client, as the host builds it. Named so the helper signatures below stay readable. */
type Client = ReturnType<typeof createAirtableClient>;

/** What every operation starts from: the view, its local port, and the link file it is about. */
type Context = {
	readonly view: TablifyView;
	readonly local: SyncLocalPort;
	/** `'grid'` when the view is mounted (a real undo step); `'vault'` when it is not. */
	readonly surface: 'grid' | 'vault';
	readonly basePath: string;
	readonly viewName: string;
	readonly linkPath: string;
	readonly document: LinkDocument;
};

/** The panel's state when there is nothing to talk about yet. */
function unlinkedState(hasToken: boolean): SyncPanelState {
	return {
		link: null,
		linkPath: `${LINK_FOLDER}/`,
		mapping: [],
		counts: null,
		blocked: null,
		conflicts: 0,
		unlinked: true,
		hasToken,
		lastRun: null,
	};
}

export function createSyncHost(options: SyncHostOptions) {
	/** The token, from `SecretStorage` only. `null` when nothing is stored. */
	const token = (): string | null => {
		const view = options.activeView();
		return view === null ? null : readToken(secretHostOf(view.app));
	};

	const store = (basePath: string, viewName: string) =>
		createLinkStore(
			{
				read: (path) => options.files.read(path),
				write: (path, text) => options.files.write(path, text),
			},
			{ basePath, viewName },
		);

	/** A client for one link. Built per call, so a token pasted a second ago is the one that gets used. */
	const clientFor = (target: LinkTarget, stored: string): Client =>
		createAirtableClient({
			token: stored,
			baseId: target.baseId,
			tableId: target.tableId,
			// Obsidian's own network path (`docs/02` §Sync: all traffic through `requestUrl`), with `throw: false` so a
			// 429's status and `Retry-After` survive as data rather than as an exception.
			transport: createRequestUrlTransport((request) => requestUrl(request)),
		});

	/**
	 * The `.base` path and the view name: the two halves of the link key (`docs/03` §Sync state).
	 *
	 * The view name is the public API's — `BasesView.config.name` (`@since 1.10.0`). The **path is not**: `BasesView`
	 * at 1.13.1 exposes `app`, `config`, `allProperties`, `data` and `type`, and nothing that names the file it came
	 * from. So the path is read from the **Bases leaf's own view state** (`WorkspaceLeaf.getViewState().state.file`),
	 * which is where Obsidian keeps the file a view was opened from, with two deliberate caveats:
	 *
	 *   · with more than one Bases leaf open, the first is used — a guess, and the reason for the check below;
	 *   · with none (an embedded base, a popout, a test), the path is empty and the key is the view name alone.
	 *
	 * The check that keeps a guess safe is in {@link context}: a link file whose **own** `basePath` is set and does
	 * not match this view's is refused with a sentence rather than used. Two same-named views in two files would
	 * otherwise quietly share one link — and sharing a link means sharing a snapshot, which means the diff compares
	 * the wrong third column.
	 */
	function linkKeyOf(view: TablifyView): {
		readonly basePath: string;
		readonly viewName: string;
		readonly certain: boolean;
	} {
		const leaves = view.app.workspace.getLeavesOfType('bases');
		const paths: string[] = [];
		for (const leaf of leaves) {
			const file = leaf.getViewState().state?.['file'];
			if (typeof file === 'string' && file.endsWith('.base')) {
				paths.push(file);
			}
		}
		return {
			basePath: paths[0] ?? '',
			viewName: view.config.name,
			certain: paths.length === 1,
		};
	}

	/**
	 * Everything an operation needs, or `null` with a reason already said out loud.
	 *
	 * A corrupt link file stops here and is **reported**, never replaced: re-creating it would drop the field
	 * mapping the person cannot rebuild from memory (`docs/03`: deleting the folder is safe because it only loses
	 * link *linkage* — losing it without being told is not the same thing).
	 */
	async function context(): Promise<Context | null> {
		const found = await loadContext();
		if (found.kind === 'none') {
			options.notify(`Tablify: ${found.reason}`);
			return null;
		}
		return found.context;
	}

	/** The shared loader. Every reason it can refuse is a sentence, because every caller has to say one. */
	async function loadContext(): Promise<
		| { readonly kind: 'ok'; readonly context: Context }
		| { readonly kind: 'none'; readonly reason: string }
	> {
		const view = options.activeView();
		if (view === null) {
			return {
				kind: 'none',
				reason: 'open a Tablify grid view first — sync is per view (docs/08 §P7).',
			};
		}
		const { basePath, viewName, certain } = linkKeyOf(view);
		const links = store(basePath, viewName);
		const load = await links.load(basePath, viewName, {
			baseId: '',
			baseName: '',
			tableId: '',
			tableName: '',
		});
		if (!load.ok) {
			return { kind: 'none', reason: load.reason };
		}
		const document = load.document;
		// The check the heuristic needs: a stored `basePath` that disagrees with this view means the key was not
		// unique enough — reported, never used.
		if (
			document.basePath !== '' &&
			basePath !== '' &&
			document.basePath !== basePath &&
			certain
		) {
			return {
				kind: 'none',
				reason: `the link file at ${links.path} belongs to ${document.basePath}, not to ${basePath}. Delete it to link this view afresh.`,
			};
		}
		const surface = view.gridStore === undefined ? 'vault' : 'grid';
		const local =
			surface === 'grid'
				? gridLocalPort({ store: view.gridStore, source: view.rowSource })
				: sourceLocalPort({ source: view.rowSource });
		return {
			kind: 'ok',
			context: { view, local, surface, basePath, viewName, linkPath: links.path, document },
		};
	}

	/** The mapping for the current link: local columns against the remote table, both directions reported. */
	async function mappingFor(
		found: Context,
		client: Client,
	): Promise<{
		readonly map: Readonly<Record<string, string>>;
		readonly unmapped: readonly UnmappedField[];
	}> {
		const description = await client.describe();
		return resolveFieldMap(
			found.view.rowSource.getSchema().fields.map((field) => field.definition.name),
			description.fields,
			found.document.fieldMap,
		);
	}

	/**
	 * The plan for a link, read-only, with no writes anywhere.
	 *
	 * This is what *"check for changes without doing anything"* means, and it is why the panel's counts can be trusted
	 * before a button is pressed: the same function the run uses is called here and thrown away.
	 */
	async function planFor(found: Context, client: Client, direction: 'pull' | 'push' | 'both') {
		const resolved = await mappingFor(found, client);
		const read = direction === 'push' ? null : await client.pull(found.document.lastPulledAt);
		return planSync({
			local: found.local,
			fields: found.view.rowSource.getSchema().fields,
			fieldMap: resolved.map,
			recordMap: found.document.recordMap,
			snapshot: found.document.snapshot,
			records: read?.records ?? [],
			// A full read is the only one that can call a missing record deleted; a `since` read cannot (its absence
			// means "unchanged"), and neither can a truncated one.
			full: read !== null && found.document.lastPulledAt === null && !read.truncated,
			truncated: read?.truncated ?? false,
			unmapped: resolved.unmapped,
		});
	}

	/** The panel's state: the link's sentence, its path, the mapping, and the plan's numbers. */
	async function panelState(): Promise<SyncPanelState> {
		let stored: string | null = null;
		try {
			stored = token();
		} catch {
			// No view open: `activeApp` cannot answer, and that is exactly the unlinked state below.
			return unlinkedState(false);
		}
		const found = await contextQuietly();
		if (found === null) {
			return unlinkedState(stored !== null);
		}
		const unresolved = {
			...unlinkedState(stored !== null),
			unlinked: false,
			linkPath: found.linkPath,
		};
		if (stored === null || found.document.airtable.baseId === '') {
			return {
				...unresolved,
				link: describeLink(found.document, []),
				mapping: [],
			};
		}
		try {
			const client = clientFor(found.document.airtable, stored);
			const resolved = await mappingFor(found, client);
			const plan = await planFor(found, client, 'both');
			return {
				...unresolved,
				link: describeLink(found.document, resolved.unmapped),
				mapping: mappingRowsOf(found.document, resolved.unmapped),
				counts: plan.counts,
				blocked: plan.blocked,
				conflicts: plan.conflicts.length,
			};
		} catch (error) {
			return {
				...unresolved,
				link: describeLink(found.document, []),
				mapping: mappingRowsOf(found.document, []),
				blocked: failureText(error),
			};
		}
	}

	/** `loadContext()` without the notification, for the panel (which shows the reason instead of announcing it). */
	async function contextQuietly(): Promise<Context | null> {
		const found = await loadContext();
		return found.kind === 'ok' ? found.context : null;
	}

	/** The mapping rows the panel renders. The document and the resolver's own report, nothing re-derived. */
	function mappingRowsOf(
		document: LinkDocument,
		unmapped: readonly UnmappedField[],
	): SyncPanelState['mapping'] {
		const rows: MappingRow[] = Object.entries(document.fieldMap).map(([property, fieldId]) => ({
			property,
			remoteField: fieldId,
			note: 'mapped',
		}));
		for (const field of unmapped) {
			rows.push(
				field.side === 'local'
					? {
							property: field.name,
							remoteField: null,
							note: 'no remote field — skipped, never created (docs/08 §P9)',
						}
					: { property: '—', remoteField: field.name, note: 'no local column — skipped' },
			);
		}
		return rows;
	}

	/**
	 * One run: plan, apply, push, then **save the link file** — the snapshot and the two stamps together, so a
	 * failure between them cannot leave a link that claims agreement it never got.
	 */
	async function run(
		direction: 'pull' | 'push' | 'both',
		choices?: ResolutionBook,
	): Promise<{ readonly message: string; readonly needsReview: boolean }> {
		const found = await context();
		if (found === null) {
			return { message: 'No linked view is open.', needsReview: false };
		}
		if (found.document.airtable.baseId === '') {
			return { message: 'This view is not linked to a table yet.', needsReview: false };
		}
		const stored = token();
		if (stored === null) {
			return {
				message: 'Add an Airtable token in Settings › Tablify › Sync first.',
				needsReview: false,
			};
		}
		try {
			const client = clientFor(found.document.airtable, stored);
			const resolved = await mappingFor(found, client);
			const report = await runSync({
				target: client,
				local: found.local,
				fields: found.view.rowSource.getSchema().fields,
				fieldMap: resolved.map,
				recordMap: found.document.recordMap,
				snapshot: found.document.snapshot,
				direction,
				...(choices === undefined ? {} : { choices }),
				// A complete review must be able to apply. Without choices every conflict is unresolved, so this gate
				// holds the same writes as the default: only a review that resolves every conflict changes anything.
				conflictGate: 'choices',
				since: direction === 'push' ? null : found.document.lastPulledAt,
				unmapped: resolved.unmapped,
			});
			const document: LinkDocument = {
				...found.document,
				fieldMap: resolved.map,
				snapshot: report.snapshot,
				// Only a run that actually read moves the cursor; only one that actually pushed stamps the push.
				lastPulledAt:
					report.pull === null ? found.document.lastPulledAt : new Date().toISOString(),
				lastPushedAt: report.push?.pushedAt ?? found.document.lastPushedAt,
			};
			await store(found.basePath, found.viewName).save(document);
			options.notify(report.summary);
			return { message: report.summary, needsReview: report.plan.conflicts.length > 0 };
		} catch (error) {
			const message = failureText(error);
			options.notify(`Tablify: ${message}`);
			return { message, needsReview: false };
		}
	}

	/** Opens the review dialog: the conflicts, side by side, and whatever the person chooses. */
	async function review(): Promise<void> {
		const found = await context();
		const stored = token();
		if (found === null || stored === null) {
			return;
		}
		try {
			const client = clientFor(found.document.airtable, stored);
			const plan = await planFor(found, client, 'both');
			if (plan.conflicts.length === 0) {
				options.notify('Tablify: nothing needs a decision.');
				return;
			}
			new ConflictReviewDialog(found.view.app, {
				spec: { conflicts: plan.conflicts },
				onConfirm: async (choices) => {
					const result = await run('both', choices);
					return result.message;
				},
			}).open();
		} catch (error) {
			options.notify(`Tablify: ${failureText(error)}`);
		}
	}

	/** The panel's host: state in, presses out. Everything that writes goes through `run`. */
	function host(): SyncPanelHost {
		return {
			name: 'this view',
			refresh: () => panelState(),
			pull: () => run('pull'),
			push: () => run('push'),
			review: () => {
				void review();
			},
			setToken: (value: string) => {
				const view = options.activeView();
				if (view === null) {
					return Promise.resolve('Open a Tablify grid view first.');
				}
				const result = writeToken(secretHostOf(view.app), value);
				return Promise.resolve(
					result.ok
						? 'Tablify: the token is stored in secret storage.'
						: (result.reason ?? 'that token was not stored'),
				);
			},
		};
	}

	/**
	 * The status-bar badge for whatever view is active.
	 *
	 * Reads the link file and nothing else: no network, no comparison, no writes. A pane with no link clears the
	 * text rather than showing a zero, because "no link" and "linked, nothing to say" are different states and a
	 * badge that conflates them is worse than no badge.
	 */
	async function updateStatus(): Promise<string> {
		try {
			const found = await contextQuietly();
			const text =
				found === null || found.document.airtable.baseId === ''
					? ''
					: `Tablify · ${found.document.airtable.tableName || found.document.airtable.tableId}`;
			options.setStatus(text);
			return text;
		} catch {
			options.setStatus('');
			return '';
		}
	}

	/** Opens the panel. The command in `main.ts` is one `await import('./sync/host')` away from this. */
	async function open(): Promise<void> {
		const view = options.activeView();
		if (view === null) {
			options.notify(
				'Tablify: open a Tablify grid view first — sync is per view (docs/08 §P7).',
			);
			return;
		}
		new SyncDialog(view.app, host(), await panelState()).open();
	}

	return { open, panelState, run, review, updateStatus, host };
}
