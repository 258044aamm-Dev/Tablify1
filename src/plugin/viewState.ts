/**
 * View state and where it lives — R2 step 7, written as data so a later step cannot guess.
 *
 * The rule (`docs/R2-repository-and-file-view.md` §Step 7, `docs/03` §view config, `docs/04` §layout):
 *
 *   - what belongs to **a view** is stored in the `.tablify` document, in that view's object;
 *   - what is a **global default** is stored in plugin settings (`data.json`);
 *   - what is **this pane, right now** is stored in Obsidian workspace state, and restoring it must
 *     never write a byte of the document;
 *   - no `.base` file, no Bases view config and no note frontmatter is read or written by any of it.
 *
 * Two of the three records below are **exhaustive by type**: `DOCUMENT_VIEW_STATE` must name every
 * key of `TableView` and `SETTINGS_VIEW_STATE` every key of `TablifySettings['appearance']`, so
 * adding a view key or a global appearance setting stops compiling until it is classified here. The
 * workspace record is short because a leaf's state genuinely is short: which table and which view
 * the pane is showing.
 *
 * What is deliberately *not* here: the pixels a density means, the grid's own layout, and anything
 * about how a saved filter is evaluated. Those are the grid's and the core's; this module only says
 * where state is kept.
 */
import type { TableView } from '../core/database/index';
import type { TablifySettings } from './settings/schema';

/** The three homes. A fourth would mean the split is wrong, not that a new home is needed. */
export type ViewStateHome = 'document' | 'settings' | 'workspace';

/** One piece of state, where it lives, and the sentence a reviewer can hold it to. */
export interface ViewStateEntry {
	readonly home: ViewStateHome;
	readonly why: string;
}

/** Every key of `TableView` except `unknown`, which is preservation bookkeeping, not view state. */
export type DocumentViewStateKey = Exclude<keyof TableView, 'unknown'>;

/**
 * What a saved view owns inside the `.tablify` file.
 *
 * The filter travels twice on purpose — the raw stored document and the decoded expression — and
 * both stay the view's: the raw form is what round-trips, the decoded form is what evaluates. The
 * same split is why `filterProblems` is here rather than in a log.
 */
export const DOCUMENT_VIEW_STATE: { readonly [Key in DocumentViewStateKey]: ViewStateEntry } = {
	id: { home: 'document', why: 'Identity: a renamed or reordered view keeps its id.' },
	name: { home: 'document', why: 'The name a person chose for this view.' },
	filter: {
		home: 'document',
		why: 'The saved filter, exactly as stored, so it round-trips through an older or newer build.',
	},
	filterExpr: {
		home: 'document',
		why: 'The decoded filter the grid evaluates, derived from the stored document above.',
	},
	filterProblems: {
		home: 'document',
		why: 'What the decoder could not read. It belongs beside the filter it describes, not in a log.',
	},
	sorts: { home: 'document', why: 'The sort stack: an ordered list, so its order is content.' },
	groupBy: { home: 'document', why: 'The grouping field, by stable field id.' },
	hiddenFieldIds: { home: 'document', why: 'Which columns this view hides.' },
	columnOrder: { home: 'document', why: 'The column arrangement this view uses.' },
	collapsedKeys: {
		home: 'document',
		why: 'Which groups are collapsed — a property of the view, not of the window it is open in.',
	},
	widths: { home: 'document', why: 'Column widths, per view, keyed by field id.' },
	density: {
		home: 'document',
		why: 'The row height this view was set to (docs/03 §view config lists density as view content).',
	},
	frozenPrimary: {
		home: 'document',
		why: 'Whether this view pins its primary column (docs/04 §layout: the freeze option).',
	},
};

/**
 * Global appearance defaults. These are **defaults**, not live view state: `defaultRowHeight` is
 * what a *new* view starts from, and a view that has one keeps its own (`DOCUMENT_VIEW_STATE.density`).
 */
export const SETTINGS_VIEW_STATE: {
	readonly [Key in keyof TablifySettings['appearance']]: ViewStateEntry;
} = {
	followObsidianTheme: {
		home: 'settings',
		why: 'A global choice about the whole plugin, not about one view.',
	},
	defaultRowHeight: {
		home: 'settings',
		why: 'The density a new view starts from; an existing view keeps the density it stored.',
	},
	motionPreference: {
		home: 'settings',
		why: 'A global accessibility preference, not view data.',
	},
};

/** What a pane remembers: where the person was, not what the document says. */
export interface TablifyLeafState {
	readonly tableId: string | null;
	readonly viewId: string | null;
}

/** The workspace-state keys, with the same `why` discipline as the other two records. */
export const WORKSPACE_VIEW_STATE: {
	readonly [Key in keyof TablifyLeafState]: ViewStateEntry;
} = {
	tableId: {
		home: 'workspace',
		why: 'Which table this pane is showing. Selecting a table is navigation, so it writes nothing.',
	},
	viewId: {
		home: 'workspace',
		why: 'Which saved view this pane is showing. Switching views is navigation, so it writes nothing.',
	},
};

/** A fresh pane has nothing selected; the panel falls back to the document’s first table. */
export const EMPTY_LEAF_STATE: TablifyLeafState = { tableId: null, viewId: null };

/**
 * Read a workspace state object into a selection. Anything unreadable becomes "nothing selected"
 * rather than an error: workspace state is written by an older build, a newer build or the user, and
 * a pane that refuses to open because a key changed shape would be a worse failure than a pane that
 * opens on the first table.
 */
export function readLeafState(state: unknown): TablifyLeafState {
	if (typeof state !== 'object' || state === null) {
		return EMPTY_LEAF_STATE;
	}
	const candidate: { tableId?: unknown; viewId?: unknown } = state;
	return {
		tableId: typeof candidate.tableId === 'string' ? candidate.tableId : null,
		viewId: typeof candidate.viewId === 'string' ? candidate.viewId : null,
	};
}

/** The state a leaf writes back. Spelled out here so `setState` and `getState` cannot drift apart. */
export function leafStateOf(selection: TablifyLeafState): Record<string, unknown> {
	return { tableId: selection.tableId, viewId: selection.viewId };
}
