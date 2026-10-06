/**
 * The grid: one scroller, three sticky lanes, and exactly one place where the scroll position becomes pixels.
 *
 * ```
 * .tablify-root            position:absolute; inset:0   ← cannot be collapsed by any ancestor
 * ├─ Toolbar              flex: 0 0 auto
 * ├─ .tablify-grid-area   flex: 1 1 auto        ← the pane §P21 measures
 * │   ├─ .tablify-scroller                     ← the ONE scroller
 * │   │   ├─ .tablify-canvas                   ← height = items × rowHeight (+ the header band)
 * │   │   └─ .tablify-rows                     ← the windowed items, in the content, moving natively
 * │   ├─ .tablify-header      translateX(-scrollLeft)
 * │   ├─ .tablify-frozen-col  translateY(headerHeight - scrollTop)     (only when pinned)
 * │   └─ .tablify-corner                                                (only when pinned)
 * └─ StatusBar            flex: 0 0 auto
 * ```
 *
 * **Why the rows are inside the scroller and the sticky lanes are not.** The row lane has to scroll with the
 * content, so it *is* content: the browser moves it, and wheel, trackpad, touch pan, momentum and `PageDown`
 * are all the platform's. The header and the frozen column must not scroll with the content, so they are
 * layers above the scroller, moved only by the transform the scroll frame writes. Putting a lane on the wrong
 * side of that line is the mistake the original build shipped (a `<table>` with `position: sticky` fighting
 * resize and drag), and the symptom is always the same: something lines up until it does not.
 *
 * **The windowing decision this file inherits.** Step 16's arithmetic is uniform-height arithmetic, so the
 * lane windows over *items* — rows and group headers alike, every one of them exactly `rowHeight` tall (see
 * `selectLaneItems`). Grouping therefore costs no second mapping between a scroll offset and an index.
 *
 * **Pinning is one derived value.** `pinnedPrimary` is computed from the pane's width in exactly one hook and
 * read by every part of this tree: the row lane draws one column fewer, the frozen lane exists or it does not,
 * and the gutter moves from one lane to the other. Nothing anywhere else asks how wide the pane is.
 *
 * **The grid never creates a note by itself.** A row *is* a file, so "New row" is only meaningful once
 * something can make one — that is the view's job (`TablifyView` calls `createFileForView`), and this component
 * takes it as a callback. Without a callback the button is absent rather than inert.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent as ReactFocusEvent, ReactElement } from 'react';

import { Empty } from './Empty';
import { FrozenLane } from './FrozenColumn';
import { Corner, HeaderLane } from './Header';
import { GroupHeader } from './GroupHeader';
import { StatusBar } from './StatusBar';
import { Row } from './rows/Row';
import type { ColumnView } from './rows/Row';
import { Toolbar } from './Toolbar';
import { DEFAULT_COLUMN_WIDTH, FALLBACK_HEADER_HEIGHT, resolvePresentation } from './layout';
import { readHeaderHeight } from './measure';
import { selectCellDisplay, selectLaneItems, useStore } from './store/selectors';
import {
	clearSelection,
	extendSelection,
	fillDown,
	fillRight,
	redo,
	selectCell,
	setCell,
	setCells,
	setSelection,
	toggleGroup,
	undo,
} from './store/commands';
import { createEditSession } from './editSession';
import { useWindow } from './useWindow';
import type { ScrollPosition } from './useWindow';
import { usePinnedPrimary } from './usePinnedPrimary';
import { windowSlice } from './store/window';
import { attachGridKeyboard } from './keyboard/handler';
import type { GridIntent, KeyContext } from './keyboard/handler';
import {
	cellKey,
	focusCell,
	queryCell,
	revealElement,
	revealRowIndex,
	rootTabIndex,
	tabStop,
} from './keyboard/focus';
import { announcementOf, gridRoleProps, LiveRegion } from './a11y/roles';
import { allOf, cellPosition, cellsOf, rowRange } from '../core/selection/range';
import type { EditSession } from './editSession';
import type { GridPresentation } from './layout';
import type { GridStore } from './store/types';
import type { CellRef, CellWrite, RowId } from '../core/ops/types';
import type { CellValue } from '../core/types';
import type { LaneItem } from './store/selectors';
import type { ResolvedField } from '../core/schema/propertySchema';
import type { CommandResult } from './store/commands';
import type { Edge, Range, RangeOrder } from '../core/selection/range';

export type GridViewProps = {
	readonly store: GridStore;
	/** The user's presentation wishes; `resolvePresentation` fills in the rest. */
	readonly presentation?: Partial<GridPresentation> | undefined;
	/**
	 * The pane's width, measured **before** the first mount by the caller. Handing it in is what stops the
	 * first frame from painting a pinned column that the second frame removes.
	 */
	readonly initialPaneWidth?: number | undefined;
	/** Creates a note and adds it to the view. Absent when the host cannot create notes. */
	readonly onNewRow?: (() => void) | undefined;
	/** Offered by the empty state when a filter is what emptied the view. */
	readonly onClearFilters?: (() => void) | undefined;
	/**
	 * Resolves an attachment path inside the vault, for `AttachmentEditor`. The grid may not ask that question
	 * itself (`src/grid/**` does not import `obsidian`), so the view that owns one answers it here. Omit it and
	 * the attachment editor simply cannot promise a file exists — see that file's header.
	 */
	readonly resolveLink?: ((path: string) => boolean) | undefined;
	/**
	 * Opens the keyboard reference — `F1` and `?` press it (step 19's key table). The grid does not own that
	 * surface: a modal is the host's, and `src/grid/**` does not import `obsidian`. Omit it and the two keys are
	 * simply left to the browser, which is honest — a help key that opened nothing would be worse.
	 */
	readonly onHelp?: (() => void) | undefined;
};

export function GridView(props: GridViewProps): ReactElement {
	const { store, presentation: patch, initialPaneWidth = 0, onNewRow, onClearFilters } = props;
	const { resolveLink, onHelp } = props;
	const presentation = useMemo(() => resolvePresentation(patch), [patch]);

	const rootRef = useRef<HTMLDivElement | null>(null);
	const areaRef = useRef<HTMLDivElement | null>(null);
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const headerLayerRef = useRef<HTMLDivElement | null>(null);
	const frozenLayerRef = useRef<HTMLDivElement | null>(null);
	const hbarRef = useRef<HTMLDivElement | null>(null);
	const vbarRef = useRef<HTMLDivElement | null>(null);
	const hthumbRef = useRef<HTMLDivElement | null>(null);
	const vthumbRef = useRef<HTMLDivElement | null>(null);

	// The header band's height is a design token, read once from the DOM so the arithmetic and the CSS cannot
	// disagree. Until that read happens (a jsdom test, or the instant before the first paint) the documented
	// fallback applies — the same 40 px the token holds.
	const [headerHeight, setHeaderHeight] = useState(FALLBACK_HEADER_HEIGHT);
	/** Bumped when focus has to move; the layout effect below is the only consumer. See `requestFocus`. */
	const [focusTick, setFocusTick] = useState(0);
	useLayoutEffect(() => {
		const measured = readHeaderHeight(rootRef.current);
		if (measured > 0) {
			setHeaderHeight(measured);
		}
	}, []);

	const items = useStore(store, selectLaneItems);
	const fields = useStore(store, (snapshot) => snapshot.fields);
	const widths = useStore(store, (snapshot) => snapshot.widths);
	const totalRows = useStore(store, (snapshot) => snapshot.result.totalRows);
	const visibleRowCount = useStore(store, (snapshot) => snapshot.rows.length);

	/**
	 * Two narrow channels, both of them primitives, which is what keeps a keystroke cheap:
	 *
	 *  · `hasSelection` a boolean — the grid's own `tabindex` and the "first cell is the way in" rule follow it,
	 *    and a boolean only re-renders this component when it flips, not on every arrow key.
	 *  · `activeKey` the active cell as a *string* (`filePath::fieldId`), compared with `Object.is` — so the
	 *    focus effect below runs when the active cell moves and not once per revision. The ref itself is read
	 *    from the snapshot inside the effect, where a fresh object is free.
	 */
	const hasSelection = useStore(store, (snapshot) => snapshot.active !== null);
	const activeKey = useStore(store, (snapshot) =>
		snapshot.active === null ? null : cellKey(snapshot.active),
	);
	/** The polite announcement (`docs/04`: "412 cells updated in 137 notes"), derived from the write report. */
	const announcement = useStore(store, announcementOf);

	const pinned = usePinnedPrimary(areaRef, presentation.frozenPrimary, initialPaneWidth);

	/**
	 * The keyboard's four pieces of scratch state, all refs because none of them is a picture of the UI:
	 *
	 *  · `pendingFocusRef` — a move happened and DOM focus has to follow it, on the next commit rather than
	 *    inside the key handler (the DOM a handler sees is the DOM *before* React applies the selection change).
	 *  · `pendingMoveRef` — a *commit key* was pressed while an editor was open. The editor commits or cancels;
	 *    if it committed, the selection moves (down for `Enter`, sideways for `Tab`).
	 *  · `bulkRef` — the open editor belongs to `Cmd/Ctrl+Enter`, so its commit writes the whole range.
	 *  · `committedRef` — the last `finish()` was a successful write, not a cancel. `onFinish` fires for both,
	 *    and moving the selection after a cancel would be a bug nobody attributes to the keyboard.
	 */
	const pendingFocusRef = useRef(false);
	/**
	 * Where that focus goes: `null` means "whatever is active now", which is the right answer for every
	 * *move*. A finished edit passes the cell it belonged to instead, because an edit is not a move: the
	 * session's last act is to hand its cell back (`editSession.ts` §`onFinish`), and in the double-click
	 * path the cell that was edited never became the active cell in the first place.
	 */
	const focusTargetRef = useRef<CellRef | null>(null);
	const pendingMoveRef = useRef<'down' | 'forward' | 'backward' | null>(null);
	const bulkRef = useRef(false);
	const committedRef = useRef(false);

	/**
	 * The one edit session. Built once per store: `useState` with an initialiser rather than `useMemo`, because
	 * a session is stateful and must never be rebuilt by a re-render (that would abandon a draft mid-edit).
	 *
	 * Its three collaborators are all callbacks into this component, which is why it lives here rather than in
	 * the store: `commit` is the command layer, `parse` is the column's own descriptor (the only thing that
	 * knows what text means in that column), and `onFinish` is focus management — the part that needs the DOM.
	 */
	const [session] = useState<EditSession>(() =>
		createEditSession({
			commit: (ref, value) => {
				// The session hands the editor's value through as `unknown`, so this is the one place a canonical
				// value is named. Everything below works on that value and nothing re-parses it.
				const canonical = value as CellValue;
				const writes = bulkWrites(store, bulkRef.current, canonical);
				const result =
					writes === null
						? setCell(store, ref, canonical)
						: setCells(store, writes, 'Edit the column');
				committedRef.current = result.ok;
				return result.ok ? { ok: true } : { ok: false, reason: result.reason };
			},
			parse: (ref, draft) => {
				const field = store
					.getSnapshot()
					.fields.find((candidate) => candidate.definition.id === ref.fieldId);
				if (field === undefined) {
					return { ok: false, reason: 'this column is no longer in the view' };
				}
				// An empty draft is "no value" for every type — the write path turns that into a deleted key
				// (`docs/03` §Frontmatter write rules, rule 3).
				if (draft.trim() === '') {
					return { ok: true, value: null };
				}
				const parsed = field.descriptor.parse(draft, field.context);
				return parsed.ok
					? { ok: true, value: parsed.value }
					: { ok: false, reason: parsed.error };
			},
			// The store's mirror of "which cell is being edited", which is what every cell subscribes to.
			onActiveChange: (ref) => {
				store.setEditing(ref);
			},
			// The follow-up to a finished edit: clear the gesture's flags, move the selection if a commit key asked
			// for it, and hand focus to whatever is active now.
			onFinish: (ref) => {
				bulkRef.current = false;
				const move = pendingMoveRef.current;
				const wrote = committedRef.current;
				pendingMoveRef.current = null;
				committedRef.current = false;
				// A commit key moves the grid on, but only if the grid *has* a selection to move: a double-click
				// opens an editor without ever selecting the cell, and there the edited cell takes the focus back.
				if (wrote && move !== null && store.getSnapshot().active !== null) {
					nudge(store, move);
					requestFocus();
					return;
				}
				// Everything else — a cancel, a blur, the `Save` button on a long text — hands focus back to the
				// cell the edit belonged to, which is the contract `docs/01` §Core interaction model states.
				requestFocus(ref);
			},
		}),
	);

	/** The layer popovers mount in: the grid area, which sits **outside** the scroller (step 17's geometry). */
	const popoverHost = useCallback((): HTMLElement | null => areaRef.current, []);

	/** Built once per revision: a scroll must not rebuild it, or every row would re-render. */
	const columns = useMemo<readonly ColumnView[]>(
		() =>
			fields.map((field) => ({
				field,
				width:
					widths.get(field.definition.id) ??
					presentation.defaultColumnWidth ??
					DEFAULT_COLUMN_WIDTH,
			})),
		[fields, widths, presentation.defaultColumnWidth],
	);
	const pinnedColumns = useMemo(() => (pinned ? columns.slice(0, 1) : []), [columns, pinned]);
	const scrollingColumns = useMemo(
		() => (pinned ? columns.slice(1) : columns),
		[columns, pinned],
	);
	const columnOffset = pinned ? 1 : 0;

	/**
	 * The one place scroll becomes pixels. Everything here is a transform or a width — never a layout
	 * property — so the frame costs no layout pass, which is what `docs/02` §Grid rendering asks for.
	 */
	const syncScroll = useCallback(
		(position: ScrollPosition): void => {
			const header = headerLayerRef.current;
			if (header !== null) {
				header.style.transform = `translateX(${String(-position.scrollLeft)}px)`;
			}
			const frozen = frozenLayerRef.current;
			if (frozen !== null) {
				frozen.style.transform = `translateY(${String(headerHeight - position.scrollTop)}px)`;
			}
			const scroller = scrollerRef.current;
			if (scroller !== null) {
				placeThumb(
					scroller.scrollTop,
					scroller.scrollHeight - scroller.clientHeight,
					vbarRef.current,
					vthumbRef.current,
					scroller.clientHeight,
					'Y',
				);
				placeThumb(
					scroller.scrollLeft,
					scroller.scrollWidth - scroller.clientWidth,
					hbarRef.current,
					hthumbRef.current,
					scroller.clientWidth,
					'X',
				);
			}
		},
		[headerHeight],
	);

	const { window: rowWindow, viewportHeight } = useWindow({
		scroller: scrollerRef,
		area: areaRef,
		rowHeight: presentation.rowHeight,
		rowCount: items.length,
		headerHeight,
		onScroll: syncScroll,
	});

	const sliced = useMemo(() => windowSlice(items, rowWindow), [items, rowWindow]);
	const rowItems = useMemo(
		() =>
			sliced.filter(
				(item): item is Extract<LaneItem, { kind: 'row' }> => item.kind === 'row',
			),
		[sliced],
	);
	const firstRowIndex = rowItems[0]?.rowIndex ?? 0;

	/* ── the keyboard ───────────────────────────────────────────────────────────────────────────────────── */

	/**
	 * A page is what the pane shows: the band the rows may draw in, divided by the row height. Measured state
	 * (`useWindow`'s `viewportHeight`), never assumed — a `tall` density in a short pane is four rows, and
	 * `PageDown` had better move four.
	 */
	const pageRows = Math.max(1, Math.floor(viewportHeight / presentation.rowHeight));

	/**
	 * Where each row sits in the *lane* — the windowing's own index, which is what a reveal needs. A `Map`
	 * rather than a `findIndex` per key press: the lane holds thousands of items and a key press should cost
	 * nothing that scales with the table.
	 */
	const rowItemIndex = useMemo(() => {
		const map = new Map<RowId, number>();
		for (const [index, item] of items.entries()) {
			if (item.kind === 'row') {
				map.set(item.filePath, index);
			}
		}
		return map;
	}, [items]);

	/**
	 * Asks for focus to follow the active cell — or, when a target is given, that exact cell — once React has
	 * applied the change. The request is remembered in a ref rather than acted on here: the DOM a handler sees
	 * is the DOM *before* this commit, and the cell being asked for may not exist yet.
	 */
	const requestFocus = useCallback((target: CellRef | null = null): void => {
		pendingFocusRef.current = true;
		focusTargetRef.current = target;
		setFocusTick((tick) => tick + 1);
	}, []);

	/**
	 * The one place DOM focus is placed. It runs after every commit that could have moved the active cell, and
	 * does nothing unless something asked for it — which is what keeps a scroll or a toolbar click from stealing
	 * the keyboard.
	 *
	 * Two paths, because rows are windowed: a mounted cell is revealed with the rects the browser already has;
	 * a cell with **no element** (the `Ctrl+End` case) is reached with the windowing's own arithmetic
	 * (`revealRowIndex`), and the second attempt happens one frame later, when the scroll read has mounted it.
	 */
	useLayoutEffect(() => {
		if (!pendingFocusRef.current) {
			return;
		}
		pendingFocusRef.current = false;
		const requested = focusTargetRef.current;
		focusTargetRef.current = null;
		const root = rootRef.current;
		const target = requested ?? store.getSnapshot().active;
		if (root === null) {
			return;
		}
		if (target === null) {
			// No cell to land on (the selection was let go): the root keeps the keyboard, so the next arrow
			// key still belongs to the grid instead of scrolling the application behind it.
			focusCell(root, null);
			return;
		}
		const cell = queryCell(root, target);
		if (cell !== null) {
			revealElement(scrollerRef.current, cell, headerHeight);
			focusCell(root, target);
			return;
		}
		revealRowIndex(
			scrollerRef.current,
			headerHeight,
			rowItemIndex.get(target.filePath) ?? -1,
			presentation.rowHeight,
		);
		window.requestAnimationFrame(() => {
			revealElement(scrollerRef.current, queryCell(rootRef.current, target), headerHeight);
			focusCell(rootRef.current, target);
		});
	}, [activeKey, focusTick, headerHeight, presentation.rowHeight, rowItemIndex, store]);

	/**
	 * Focus landing on the grid **itself** is routed to the active cell — *"focusing the grid restores the last
	 * active cell"* — while a focus that lands on a cell, or on an open editor's input, is already where it
	 * should be. With nothing selected the root keeps the focus: it is the tab stop, and the first arrow key
	 * starts from the first cell anyway (`extendSelection` defaults to the top-left when there is no range).
	 *
	 * The `target !== currentTarget` guard is load-bearing and was found by a test, not by reading: React's
	 * `onFocus` is `focusin`, so it bubbles — without the guard, *any* focus inside the grid asked for a re-focus
	 * of the active cell, which blurred the editor's input the instant it mounted, which committed the empty
	 * draft, which closed the editor. The symptom was "Enter never opens an editor"; the cause was this line.
	 */
	const onRootFocus = useCallback(
		(event: ReactFocusEvent<HTMLDivElement>): void => {
			if (event.target !== event.currentTarget) {
				return;
			}
			if (store.getSnapshot().active !== null) {
				requestFocus();
			}
		},
		[store, requestFocus],
	);

	/** Whether the cell can be edited at all: the same predicate `editorFor` applies (step 18's registry). */
	const editableField = useCallback(
		(ref: CellRef): ResolvedField | null => {
			const field = store
				.getSnapshot()
				.fields.find((candidate) => candidate.definition.id === ref.fieldId);
			if (field === undefined || field.readOnly || !field.descriptor.editable) {
				return null;
			}
			return field;
		},
		[store],
	);

	/**
	 * Opens the session on a cell. Used by three intents (`Enter`/`F2`, typing, `Cmd/Ctrl+Enter`) and the
	 * double-click in `Cell` — the difference between them is only the draft it starts with and whether the
	 * commit fans out over the range.
	 */
	const openEditor = useCallback(
		(ref: CellRef, text: string, bulk: boolean): boolean => {
			if (editableField(ref) === null) {
				return false;
			}
			bulkRef.current = bulk;
			// If a previous editor could not commit, it stays open with its error and this call does nothing —
			// the key was still handled (the grid refused), which is what keeps the draft from being split.
			session.open(ref, text);
			return true;
		},
		[editableField, session],
	);

	/** What the resolver needs to know right now. Read per key press: a stale context is a wrong decision. */
	const readContext = useCallback((): KeyContext => {
		const snapshot = store.getSnapshot();
		if (snapshot.editing !== null) {
			return { editing: true, checkbox: false, pageRows };
		}
		const ref = snapshot.active;
		const field = ref === null ? null : editableField(ref);
		return {
			editing: false,
			// The declared editor id, exactly as `registry.tsx` keys on it — never a re-derivation from the type.
			checkbox: field !== null && field.descriptor.editor === 'checkbox',
			pageRows,
		};
	}, [store, editableField, pageRows]);

	/**
	 * Runs one intent. `false` means "the grid did not act on this", which is what lets the key through untouched
	 * (`handler.ts` prevents the default only when this answered `true`).
	 */
	const runIntent = useCallback(
		(intent: GridIntent): boolean => {
			switch (intent.id) {
				case 'move':
				case 'navigate-edges': {
					const snapshot = store.getSnapshot();
					const steps = intent.id === 'navigate-edges' ? intent.steps : 1;
					const result =
						steps > 1 && snapshot.active !== null
							? pageMove(store, snapshot.active, intent.edge, steps, intent.extend)
							: extendSelection(store, intent.edge, intent.extend);
					if (!result.ok) {
						return false;
					}
					requestFocus();
					return true;
				}
				case 'edit':
				case 'bulk-edit': {
					const ref = store.getSnapshot().active;
					if (ref === null) {
						return false;
					}
					return openEditor(
						ref,
						selectCellDisplay(store.state(), ref),
						intent.id === 'bulk-edit',
					);
				}
				case 'type-to-replace': {
					const ref = store.getSnapshot().active;
					if (ref === null) {
						return false;
					}
					return openEditor(ref, intent.text, false);
				}
				case 'commit-tab': {
					const snapshot = store.getSnapshot();
					const from = snapshot.active;
					if (from === null) {
						return false;
					}
					const target = tabStop(snapshot.order, from, intent.direction);
					// `null` is the edge of the grid: the key stops being ours and the browser moves focus on —
					// which is the doc's rule for `Tab` (*move within the grid, and leave the grid at the last cell*).
					if (target === null) {
						return false;
					}
					selectCell(store, target);
					requestFocus();
					return true;
				}
				case 'toggle-checkbox': {
					const ref = store.getSnapshot().active;
					if (ref === null) {
						return false;
					}
					const field = editableField(ref);
					if (field === null) {
						return false;
					}
					return setCell(store, ref, checkboxNext(field, store, ref)).ok;
				}
				case 'select-all': {
					const snapshot = store.getSnapshot();
					const range = selectAllRange(snapshot.order, snapshot.active);
					if (range === null) {
						return false;
					}
					setSelection(store, range);
					return true;
				}
				case 'clear':
					return clearSelection(store).ok;
				case 'escape': {
					if (store.getSnapshot().selection === null) {
						return false;
					}
					// Nothing is open (an open editor never reaches here — it owns the keyboard), so Escape means
					// "let go of the selection". The doc's word for it is the second half of the same key.
					setSelection(store, null);
					return true;
				}
				case 'undo-redo': {
					const result = intent.verb === 'undo' ? undo(store) : redo(store);
					return result.ok;
				}
				case 'fill': {
					const result = intent.direction === 'down' ? fillDown(store) : fillRight(store);
					return result.ok;
				}
				case 'help':
					onHelp?.();
					return onHelp !== undefined;
				case 'clipboard':
					// Step 22 wires what is on the clipboard (TSV + HTML, three paste modes). Until then the key is
					// *not handled*, so `Cmd+C` still copies the text a person selected and nothing is swallowed.
					return false;
				case 'commit-move':
					// Observed, never dispatched: `handler.ts` routes it to `onCommitKey`, and the follow-up happens
					// in `onFinish` once the editor has actually committed.
					return false;
				default:
					return false;
			}
		},
		[store, requestFocus, openEditor, editableField, onHelp],
	);

	/** A commit key pressed inside an open editor: recorded now, applied when the editor finishes. */
	const onCommitKey = useCallback((intent: GridIntent): void => {
		pendingMoveRef.current = intent.id === 'commit-move' ? intent.direction : null;
	}, []);

	/**
	 * The one listener. Attached to the grid root (never to `document`) and detached with the view, and it is
	 * capture-phase on purpose: the grid has to *see* `Tab` before an open editor consumes it, or the follow-up
	 * move after a commit could never happen.
	 */
	useEffect(() => {
		const root = rootRef.current;
		if (root === null) {
			return;
		}
		const attachment = attachGridKeyboard(root, {
			context: readContext,
			dispatch: runIntent,
			onCommitKey,
		});
		return () => {
			attachment.detach();
		};
	}, [readContext, runIntent, onCommitKey]);

	const onActivate = useCallback(
		(ref: CellRef, extend: boolean): void => {
			if (!extend) {
				selectCell(store, ref);
				return;
			}
			// Shift+click extends the range *to the clicked cell*, keeping the anchor where it was — which is
			// what `docs/01` §Core interaction model means by "extend the range from the anchor".
			const selection = store.getSnapshot().selection;
			setSelection(store, {
				anchor: selection === null ? ref : selection.anchor,
				focus: ref,
			});
		},
		[store],
	);

	const onToggleRow = useCallback(
		(filePath: RowId, checked: boolean): void => {
			if (!checked) {
				clearSelection(store);
				return;
			}
			setSelection(store, rowRange(filePath, store.getSnapshot().order));
		},
		[store],
	);

	const onToggleGroup = useCallback(
		(key: string): void => {
			toggleGroup(store, key);
		},
		[store],
	);

	const isEmpty = items.length === 0;
	const canvasStyle = useMemo<CSSProperties>(
		// The scroll range is the items plus the header band they slide under: without the band the last row
		// could not be scrolled clear of the header, which is the classic "last row is unreachable" bug.
		() => ({ height: `${String(rowWindow.totalHeight + headerHeight)}px` }),
		[rowWindow.totalHeight, headerHeight],
	);
	const rowsStyle = useMemo<CSSProperties>(
		() => ({
			top: `${String(headerHeight)}px`,
			transform: `translateY(${String(rowWindow.offsetY)}px)`,
		}),
		[headerHeight, rowWindow.offsetY],
	);

	return (
		<div
			className="tablify-root"
			ref={rootRef}
			{...gridRoleProps({
				label: 'Tablify grid',
				rowCount: visibleRowCount,
				columnCount: columns.length,
			})}
			// The roving tab stop (step 19): the grid itself is the way in while nothing is selected, and the
			// active cell takes the stop over the moment there is one — exactly one element is ever tabbable.
			tabIndex={rootTabIndex(hasSelection)}
			// Focus that lands on the grid rather than on a cell is routed to the active cell.
			onFocus={onRootFocus}
		>
			<Toolbar store={store} {...(onNewRow === undefined ? {} : { onNewRow })} />

			<div className="tablify-grid-area" ref={areaRef}>
				<div className="tablify-scroller" ref={scrollerRef}>
					<div className="tablify-canvas" style={canvasStyle} />
					<div className="tablify-layer tablify-rows" style={rowsStyle}>
						{sliced.map((item) =>
							item.kind === 'group' ? (
								<GroupHeader
									key={`g:${item.key}`}
									groupKey={item.key}
									label={item.label}
									count={item.count}
									collapsed={item.collapsed}
									onToggle={onToggleGroup}
								/>
							) : (
								<Row
									key={item.filePath}
									store={store}
									filePath={item.filePath}
									rowIndex={item.rowIndex}
									columns={scrollingColumns}
									columnOffset={columnOffset}
									gutter={!pinned}
									onActivate={onActivate}
									onToggleRow={onToggleRow}
									session={session}
									popoverHost={popoverHost}
									{...(resolveLink === undefined ? {} : { resolveLink })}
								/>
							),
						)}
					</div>
				</div>

				<div className="tablify-layer tablify-header" ref={headerLayerRef}>
					<HeaderLane
						columns={scrollingColumns}
						columnOffset={columnOffset}
						gutter={!pinned}
					/>
				</div>

				{pinned ? (
					<div className="tablify-layer tablify-frozen-col" ref={frozenLayerRef}>
						<FrozenLane
							store={store}
							rows={rowItems.map((item) => item.filePath)}
							firstRowIndex={firstRowIndex}
							columns={pinnedColumns}
							onActivate={onActivate}
							onToggleRow={onToggleRow}
							session={session}
							popoverHost={popoverHost}
							{...(resolveLink === undefined ? {} : { resolveLink })}
						/>
					</div>
				) : null}

				{pinned ? (
					<div className="tablify-layer tablify-corner">
						<Corner columns={pinnedColumns} gutter />
					</div>
				) : null}

				{isEmpty ? (
					<Empty
						totalRows={totalRows}
						filtered={totalRows > 0}
						{...(onNewRow === undefined ? {} : { onNewRow })}
						{...(onClearFilters === undefined ? {} : { onClearFilters })}
					/>
				) : null}

				{/* The two drawn scrollbars. The scroller's own are hidden — an OS scrollbar is neither
				    themable nor finger-sized (docs/04) — so these are the visible ones; step 20 adds dragging. */}
				<div className="tablify-hbar" ref={hbarRef} aria-hidden="true">
					<div className="tablify-hbar-thumb" ref={hthumbRef} />
				</div>
				<div className="tablify-vbar" ref={vbarRef} aria-hidden="true">
					<div className="tablify-vbar-thumb" ref={vthumbRef} />
				</div>
			</div>

			<StatusBar store={store} />

			{/* One polite live region for the whole grid, mounted for the life of the view: it is the *change* in a
			    live region that a screen reader announces, so a region re-created per render announces nothing. */}
			<LiveRegion message={announcement} />
		</div>
	);
}

/**
 * The writes a `Cmd/Ctrl+Enter` commit fans out over: one write per cell of the range, or `null` when the
 * gesture was a plain edit.
 *
 * One `setCells` op, therefore one undo step and one queue batch — which is why the doc's "bottom-up" ordering
 * does not need to be reproduced here: the op carries the whole set, so no write can see another's result.
 */
function bulkWrites(
	store: GridStore,
	bulk: boolean,
	value: CellValue,
): readonly CellWrite[] | null {
	if (!bulk) {
		return null;
	}
	const snapshot = store.getSnapshot();
	const range = snapshot.selection;
	if (range === null) {
		return null;
	}
	const cells = cellsOf(range, snapshot.order);
	if (cells.length === 0) {
		return null;
	}
	return cells.map((cell) => ({ ...cell, value }));
}

/**
 * The follow-up move after a commit: `Enter` moves down a row, `Tab`/`Shift+Tab` move sideways and wrap at the
 * end of a row. Both are *moves* — the anchor follows the focus, so the range a commit just wrote is not left
 * selected behind the user.
 */
function nudge(store: GridStore, direction: 'down' | 'forward' | 'backward'): void {
	const snapshot = store.getSnapshot();
	const from = snapshot.active;
	if (from === null) {
		return;
	}
	if (direction === 'down') {
		extendSelection(store, 'down', false);
		return;
	}
	const target = tabStop(snapshot.order, from, direction);
	if (target !== null) {
		selectCell(store, target);
	}
}

/**
 * A page key: the active cell moves a screenful down or up, keeping its column.
 *
 * One selection change rather than `steps` of them: `PageDown` on a 5,000-row view must not be twelve store
 * dispatches and twelve renders, and the arithmetic is the same index lookup `tabStop` uses.
 */
function pageMove(
	store: GridStore,
	from: CellRef,
	edge: Edge,
	steps: number,
	extend: boolean,
): CommandResult {
	const snapshot = store.getSnapshot();
	const at = cellPosition(from, snapshot.order);
	const delta = edge === 'up' ? -steps : steps;
	if (at === null || (edge !== 'up' && edge !== 'down')) {
		return extendSelection(store, edge, extend);
	}
	const row = Math.min(Math.max(0, at.row + delta), snapshot.order.rows.length - 1);
	const filePath = snapshot.order.rows[row];
	if (filePath === undefined) {
		return { ok: false, reason: 'this view has no rows to move through' };
	}
	const target: CellRef = { filePath, fieldId: from.fieldId };
	return extend
		? setSelection(store, { anchor: snapshot.anchor ?? from, focus: target })
		: selectCell(store, target);
}

/**
 * Every cell of the view, with the *current* cell kept as the range's focus so `Cmd/Ctrl+A` selects without
 * moving the keyboard. `core`'s `allOf` answers the whole grid with the last cell as the focus, which is right
 * for a programmatic selection and wrong for a shortcut a person presses while looking at a cell.
 */
function selectAllRange(order: RangeOrder, active: CellRef | null): Range | null {
	const whole = allOf(order);
	if (whole === null) {
		return null;
	}
	return active === null ? whole : { anchor: whole.anchor, focus: active };
}

/**
 * What `Space` writes on a checkbox cell: the opposite of what the cell shows.
 *
 * The rule is `CheckboxEditor`'s, deliberately, and it is read from the column's own parser rather than from a
 * table of words: the cell shows `Yes`/`No`, the descriptor's `parse` accepts those words and `true`/`1`/`on`,
 * and anything it cannot parse becomes `true` — which is what a person toggling an unreadable cell means.
 */
function checkboxNext(field: ResolvedField, store: GridStore, ref: CellRef): boolean {
	const parsed = field.descriptor.parse(selectCellDisplay(store.state(), ref), field.context);
	return parsed.ok && parsed.value === true ? false : true;
}

/**
 * One thumb: the fraction of the track the viewport covers, floored at 12 px so a 5,000-row view still has
 * something to grab, and positioned by the scroll ratio. Written straight onto the element — the scroll frame
 * may not touch React state, which is the same rule the lanes follow.
 */
function placeThumb(
	offset: number,
	maxOffset: number,
	track: HTMLElement | null,
	handle: HTMLElement | null,
	trackLength: number,
	axis: 'X' | 'Y',
): void {
	if (track === null || handle === null) {
		return;
	}
	const length = axis === 'X' ? track.clientWidth : track.clientHeight;
	const content = trackLength + Math.max(0, maxOffset);
	const ratio = content <= 0 ? 1 : Math.min(1, Math.max(0.05, trackLength / content));
	const size = Math.max(12, Math.round(length * ratio));
	const travel = Math.max(0, length - size);
	const position = maxOffset <= 0 ? 0 : Math.round((offset / maxOffset) * travel);
	if (axis === 'X') {
		handle.style.width = `${String(size)}px`;
		handle.style.transform = `translateX(${String(position)}px)`;
	} else {
		handle.style.height = `${String(size)}px`;
		handle.style.transform = `translateY(${String(position)}px)`;
	}
}
