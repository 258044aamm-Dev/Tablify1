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
import type {
	CSSProperties,
	FocusEvent as ReactFocusEvent,
	MouseEvent as ReactMouseEvent,
	PointerEvent as ReactPointerEvent,
	ReactElement,
} from 'react';

import { Empty } from './Empty';
import { FrozenLane } from './FrozenColumn';
import { Corner, HeaderLane } from './Header';
import { GroupHeader } from './GroupHeader';
import { StatusBar } from './StatusBar';
import { Row } from './rows/Row';
import type { ColumnView } from './rows/Row';
import { Toolbar } from './Toolbar';
import {
	DEFAULT_COLUMN_WIDTH,
	FALLBACK_GUTTER_WIDTH,
	FALLBACK_HEADER_HEIGHT,
	resolvePresentation,
} from './layout';
import { paneWidthOf, readHeaderHeight, readPxToken } from './measure';
import {
	selectCellDisplay,
	selectLaneItems,
	useSelectionRevision,
	useStore,
} from './store/selectors';
import {
	clearSelection,
	extendSelection,
	fillDown,
	fillRight,
	moveRowTo,
	redo,
	reorderColumn,
	resizeColumn,
	selectCell,
	setCell,
	setCells,
	setSelection,
	toggleGroup,
	undo,
} from './store/commands';
import { createEditSession } from './editSession';
import { applyBulkEdit, applyBulkEditDraft } from './commands/bulkEdit';
import { useWindow } from './useWindow';
import type { ScrollPosition } from './useWindow';
import { usePinnedPrimary } from './usePinnedPrimary';
import { windowSlice } from './store/window';
import { attachGridKeyboard } from './keyboard/handler';
import { cellAtPoint, columnAtPoint, offsetsOf, rowAtPoint, splitCellKey } from './pointer/hitTest';
import { beginColumnResize } from './pointer/resizeColumn';
import { beginColumnReorder } from './pointer/reorderColumn';
import { beginFillDrag } from './pointer/fillHandle';
import { beginRowReorder } from './pointer/reorderRow';
import { beginScrollDrag, offsetForTrackClick, thumbGeometry } from './pointer/scrollBar';
import { cellMenuItems } from './menus/cellMenu';
import { gutterMenuItems } from './menus/gutterMenu';
import { headerMenuItems } from './menus/headerMenu';
import { showMenu } from './menus/items';
import { fieldOf, menuBounds } from './menus/context';
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
import { createClipboardHost } from './clipboard/host';
import { matrixOfSelection, payloadHtml, payloadTsv } from './clipboard/matrix';
import { needsDialog, planPaste, readAndPlan } from './clipboard/pastePlan';
import { applyPlan, pasteSentence } from './clipboard/wiring';
import { startRangeDrag, useCoarsePointer } from './selection/dragSelect';
import {
	allOf,
	cellPosition,
	cellsOf,
	columnRange,
	normalize,
	rowRange,
} from '../core/selection/range';
import type { EditSession } from './editSession';
import type { GridPresentation } from './layout';
import type { GridStore } from './store/types';
import type { CellRef, CellWrite, RowId } from '../core/ops/types';
import type { CellValue, PropertyId } from '../core/types';
import type { LaneItem } from './store/selectors';
import type { ResolvedField } from '../core/schema/propertySchema';
import type { CommandResult } from './store/commands';
import type { Edge, Range, RangeOrder } from '../core/selection/range';
import type { DialogPort } from './dialogs/port';
import type { GridDialogId, GridMenuPorts, GridRowPorts } from './menus/context';
import type { ClipboardHost } from './clipboard/host';
import type { ClipboardPayload } from './clipboard/matrix';
import type { PasteModeId, PasteSetting } from './clipboard/pastePlan';
import type { CreateRows } from './clipboard/wiring';

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
	/**
	 * The grid's own dialogs, built by whoever mounts the grid. `src/grid/**` may not import `obsidian` outside
	 * `menus/` and `dialogs/`, so the four dialogs are constructed there and handed over as a port — the same
	 * arrangement `onHelp` and `resolveLink` already use, and the reason this component stays host-agnostic.
	 * Omit it and the menu/dialog items say so instead of opening nothing.
	 */
	readonly dialogs?: DialogPort | undefined;
	/**
	 * The view's own row actions (create a note, duplicate it, delete it). The grid cannot do any of them: they
	 * are file operations. `null`/absent ⇒ the menu items that need them are disabled with a reason.
	 */
	readonly rows?: GridRowPorts | undefined;
	/**
	 * Reports a presentation change back to the host (density, the frozen primary column). The grid renders what it
	 * is given, so this is how a change made *inside* a dialog reaches the next render.
	 */
	readonly onPresentation?: ((patch: Partial<GridPresentation>) => void) | undefined;
	/**
	 * How a pasted block lands: the three settings that decide the dialog, and the one capability only the view
	 * has — **creating notes**. Omitted entirely, a paste still fills cells and says that it could not create
	 * rows; the settings' defaults (`expand` + the doc's threshold) are assumed so a host that has not been
	 * wired yet behaves like the shipped defaults rather than like a build with the feature switched off.
	 */
	readonly paste?: PasteOptions | undefined;
};

/** The view's half of a paste (see `GridViewProps.paste`). */
export type PasteOptions = {
	/** `import.clipboardPasteMode`: ask every time, grow the table, or stay inside the selection. */
	readonly mode: PasteSetting;
	readonly warnOnLargeImport: boolean;
	readonly largeImportThreshold: number;
	/** Creates the notes a paste asks for, and answers with the rows they became. */
	readonly createRows?: CreateRows | undefined;
};

export function GridView(props: GridViewProps): ReactElement {
	const { store, presentation: patch, initialPaneWidth = 0, onNewRow, onClearFilters } = props;
	const { resolveLink, onHelp, paste } = props;
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
	const fillRef = useRef<HTMLDivElement | null>(null);

	// The header band's height is a design token, read once from the DOM so the arithmetic and the CSS cannot
	// disagree. Until that read happens (a jsdom test, or the instant before the first paint) the documented
	// fallback applies — the same 40 px the token holds.
	const [headerHeight, setHeaderHeight] = useState(FALLBACK_HEADER_HEIGHT);
	/**
	 * The gutter's width, read once from the DOM like the header band's: the pinned column's inset is
	 * `gutter + primary width`, and that arithmetic has to agree with the CSS the frozen lane is drawn with.
	 */
	const [gutterWidth, setGutterWidth] = useState(FALLBACK_GUTTER_WIDTH);
	/** Bumped when focus has to move; the layout effect below is the only consumer. See `requestFocus`. */
	const [focusTick, setFocusTick] = useState(0);
	/**
	 * The dialog port, held in a ref rather than read from props inside callbacks: the port is rebuilt whenever the
	 * view re-renders (`createDialogPort` closes over the app), and a port in a dependency array would re-create
	 * every menu and pointer handler on every render — which is exactly the "one user action, three renders" budget
	 * step 16 measured. The ref's value is the freshest one; nothing observes its identity.
	 */
	const dialogsRef = useRef<DialogPort | null>(props.dialogs ?? null);
	dialogsRef.current = props.dialogs ?? null;
	/**
	 * The presentation change channel, in a ref for the same reason: the view's own `onPresentation` is a fresh
	 * arrow function on every render, and a dialog opener that re-created itself per render would re-render the
	 * menu handlers that hold it.
	 */
	const onPresentationRef = useRef(props.onPresentation);
	onPresentationRef.current = props.onPresentation;
	useLayoutEffect(() => {
		const measured = readHeaderHeight(rootRef.current);
		if (measured > 0) {
			setHeaderHeight(measured);
		}
		setGutterWidth(readPxToken(rootRef.current, '--tablify-gutter-w', FALLBACK_GUTTER_WIDTH));
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
	/**
	 * A message the **clipboard** wants announced ("2,400 cells pasted · 400 notes created"), or `''`.
	 *
	 * The live region's normal source is the write report on the snapshot; a paste is the one action whose most
	 * important sentence is not in that report — how many *notes* it made, and whether the row-creation half
	 * could run at all. So this overrides the region for one message, which is the same mechanism the report
	 * uses: a change in a region that never unmounts.
	 */
	const [pasteMessage, setPasteMessage] = useState('');
	/** The browser's clipboard, created once per mount (it closes over one document). */
	const clipboardHost: ClipboardHost = useMemo(() => createClipboardHost(), []);
	/** Whether a finger drag selects instead of scrolling — `docs/04` §Touch's explicit toggle. */
	const [rangeSelect, setRangeSelect] = useState(false);
	const coarsePointer = useCoarsePointer();

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
				// One command for the whole-selection case (step 23): bottom-up order, one `setCells`, one undo
				// step, and the count the live region announces. A plain commit stays a single-cell write.
				const result = bulkRef.current
					? applyBulkEdit(store, canonical, ref.fieldId)
					: setCell(store, ref, canonical);
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
	 * How far the **scrolling** lanes are pushed right so they begin after the pinned column.
	 *
	 * The frozen lane is an overlay: it draws the gutter and the primary column on top of the row lane. Without
	 * this inset the scrolling lane still starts at x = 0, so its first column is *underneath* the frozen lane
	 * and the second is half-hidden by it — the header said "DUE" where the table was showing the third column,
	 * and a whole column was unreachable. The layout harness measured it (assertion 14 in `tests/layout/tier4.spec.ts`).
	 *
	 * It is `left`, not a margin: the lane's own transform is the scroll offset, written sixty times a second by
	 * `syncScroll`, and a second transform on the same element would fight it.
	 */
	const pinnedInset = pinned ? gutterWidth + (pinnedColumns[0]?.width ?? 0) : 0;

	/**
	 * The scroll frame needs the fill handle's placer, and the frame is set up *before* it (the frame owns the
	 * window, the window feeds the lanes, and the lanes decide where the corner cell is). One ref closes that loop
	 * without reordering a hundred lines of layout code: the frame calls "whatever the latest placer is".
	 */
	const placeFillHandleRef = useRef<() => void>(() => undefined);

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
				// The handle rides the corner cell, so a scroll moves it exactly as much as the cell moved.
				placeFillHandleRef.current();
			}
		},
		// `placeFillHandleRef` rather than the placer itself: the frame is defined before the placer (the frame owns
		// the window, the window feeds the lanes, the lanes decide where the corner is), and the ref is what lets the
		// frame call "whatever the latest placer is" without reordering a hundred lines of layout code.
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
	/**
	 * **Copy.** Builds both flavours from the selection and puts them on the clipboard.
	 *
	 * The event path (below) is the primary one and is best: the browser hands us a `clipboardData` and both
	 * flavours go on it synchronously, with no permission and no prompt. This function is what the *menu*, the
	 * keyboard chord when no event fires, and the toolbar use — it goes through `ClipboardHost`, which reports
	 * which path ran so the grid can say "use Ctrl+C instead" when the asynchronous API was refused.
	 */
	const copySelection = useCallback(
		async (verb: 'copy' | 'cut'): Promise<void> => {
			const snapshot = store.getSnapshot();
			const matrix = matrixOfSelection(store.state(), snapshot.order, snapshot.selection);
			if (matrix.length === 0) {
				setPasteMessage('Nothing is selected to copy.');
				return;
			}
			const path = await clipboardHost.write({
				tsv: payloadTsv(matrix),
				html: payloadHtml(matrix),
			});
			if (path === 'unavailable') {
				setPasteMessage('The clipboard is not available here. Use Ctrl/Cmd+C instead.');
				return;
			}
			const cells = matrix.reduce((sum, row) => sum + row.length, 0);
			if (verb === 'copy') {
				setPasteMessage(`${cells.toLocaleString('en-GB')} cell(s) copied.`);
				return;
			}
			// `cut` is a copy **then** a clear: the two are separate on purpose, so a clear that fails leaves the
			// copied values on the clipboard rather than losing them (`docs/07` §Tier 1's round-trip rule).
			const cleared = clearSelection(store);
			setPasteMessage(
				cleared.ok
					? `${cells.toLocaleString('en-GB')} cell(s) cut.`
					: `${cells.toLocaleString('en-GB')} cell(s) copied, but the cells could not be cleared: ${cleared.reason}`,
			);
		},
		[store, clipboardHost],
	);

	/** Puts a payload on the grid's own `copy` event, which is the path that carries both flavours for free. */
	const fillCopyEvent = useCallback(
		(event: ClipboardEvent): boolean => {
			const data = event.clipboardData;
			if (data === null) {
				return false;
			}
			const snapshot = store.getSnapshot();
			const matrix = matrixOfSelection(store.state(), snapshot.order, snapshot.selection);
			if (matrix.length === 0) {
				return false;
			}
			event.preventDefault();
			data.setData('text/plain', payloadTsv(matrix));
			data.setData('text/html', payloadHtml(matrix));
			const cells = matrix.reduce((sum, row) => sum + row.length, 0);
			setPasteMessage(`${cells.toLocaleString('en-GB')} cell(s) copied.`);
			return true;
		},
		[store],
	);

	/**
	 * **Paste.** A payload goes through `readAndPlan` — HTML first, then TSV, then CSV — and then either the
	 * dialog or straight to `applyPlan`. Nothing here writes: `applyPlan` takes the plan, which is what makes
	 * "never create notes without the confirmation dialog" a property of the code rather than of the review.
	 */
	const pastePayload = useCallback(
		(payload: ClipboardPayload): void => {
			const snapshot = store.getSnapshot();
			const base = {
				state: store.state(),
				order: snapshot.order,
				anchor: snapshot.active,
				setting: paste?.mode ?? 'expand',
				largeThreshold: paste?.largeImportThreshold ?? 250,
			};
			const { read, plan } = readAndPlan({ ...base, payload });
			if (read.flavour === 'empty') {
				setPasteMessage('The clipboard holds nothing readable.');
				return;
			}
			const port = dialogsRef.current;
			const run = (mode: PasteModeId): void => {
				const chosen = planPaste({ ...base, matrix: read.matrix, mode });
				void applyPlan(store, chosen, { createRows: paste?.createRows }).then((outcome) => {
					setPasteMessage(pasteSentence(outcome));
				});
			};
			if (needsDialog(plan, base.setting)) {
				if (port === null) {
					// The rule this branch exists for: **no confirmation dialog, no created notes.** A host that
					// cannot offer the dialog cannot offer the choice, and a choice made for someone else — a
					// thousand notes nobody agreed to — is exactly what the dialog is for.
					setPasteMessage(
						'This paste needs a choice, and this view cannot show the dialog. Use Ctrl/Cmd+V in the grid.',
					);
					return;
				}
				port.pasteBlock({
					base: { ...base, matrix: read.matrix },
					setting: base.setting,
					warnOnLargeImport: paste?.warnOnLargeImport ?? true,
					largeImportThreshold: base.largeThreshold,
					onChoose: run,
				});
				return;
			}
			// No dialog: `cells` is the only mode that means anything without a choice (filling from the anchor),
			// and `append`/`create` are the two answers the dialog exists to offer.
			run('cells');
		},
		[store, paste],
	);

	/** The context-menu **Paste**: the only way in that has to *read* the clipboard rather than receive it. */
	const pasteFromClipboard = useCallback((): void => {
		void clipboardHost.read().then((read) => {
			if (read === null) {
				setPasteMessage(
					'The clipboard is empty, or reading it was refused. Use Ctrl/Cmd+V instead.',
				);
				return;
			}
			pastePayload(read.payload);
		});
	}, [clipboardHost, pastePayload]);

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
				case 'clipboard': {
					// Copy and cut go through the host (the event path is the *other* way in, and it is better:
					// see `fillCopyEvent`). Paste has no keyboard path at all — the browser's own `paste` event
					// carries both flavours, and intercepting `Cmd+V` to read a text-only clipboard would be a
					// downgrade. The key is therefore *not handled* here, which leaves the event free to arrive.
					if (intent.verb === 'paste') {
						return false;
					}
					void copySelection(intent.verb);
					return true;
				}
				case 'commit-move':
					// Observed, never dispatched: `handler.ts` routes it to `onCommitKey`, and the follow-up happens
					// in `onFinish` once the editor has actually committed.
					return false;
				default:
					return false;
			}
		},
		[store, requestFocus, openEditor, editableField, onHelp, copySelection],
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
		/**
		 * The clipboard's **event** path — the primary one, and the only path that carries `text/html` in both
		 * directions without a permission prompt. `copy` and `cut` are filled in from the selection; `paste` is
		 * read here and planned by the same code the menu uses, so there is exactly one paste semantics.
		 *
		 * An open editor keeps its own clipboard behaviour: `event.target` inside `.cell-editor` means the person
		 * is copying *text they typed*, not the grid's range, and swallowing that would be the worse bug.
		 */
		const insideEditor = (event: Event): boolean =>
			event.target instanceof Element && event.target.closest('.cell-editor') !== null;
		const onCopy = (event: ClipboardEvent): void => {
			if (insideEditor(event)) {
				return;
			}
			fillCopyEvent(event);
		};
		const onCut = (event: ClipboardEvent): void => {
			if (insideEditor(event)) {
				return;
			}
			const copied = fillCopyEvent(event);
			if (copied) {
				clearSelection(store);
			}
		};
		const onPaste = (event: ClipboardEvent): void => {
			if (insideEditor(event)) {
				return;
			}
			const data = event.clipboardData;
			if (data === null) {
				return;
			}
			const html = data.getData('text/html');
			const text = data.getData('text/plain');
			if (html === '' && text === '') {
				return;
			}
			event.preventDefault();
			pastePayload({ html, text });
		};
		root.addEventListener('copy', onCopy);
		root.addEventListener('cut', onCut);
		root.addEventListener('paste', onPaste);
		return () => {
			attachment.detach();
			root.removeEventListener('copy', onCopy);
			root.removeEventListener('cut', onCut);
			root.removeEventListener('paste', onPaste);
		};
	}, [readContext, runIntent, onCommitKey, fillCopyEvent, pastePayload, store]);

	/**
	 * Places the fill handle over the selection's bottom-right cell.
	 *
	 * Measured rather than computed, and deliberately: the corner's position is the sum of the gutter's width, every
	 * column's width before it, which lane the cell is in, the scroll offsets and the windowing's transform — six
	 * numbers the browser has already added up. One `getBoundingClientRect` on one mounted element answers all of
	 * them, which is the same trade `revealElement` makes. It runs on a selection change and inside the scroll frame
	 * (where `docs/04` allows a read), never per pointer move.
	 */
	const placeFillHandle = useCallback((): void => {
		const handle = fillRef.current;
		const area = areaRef.current;
		if (handle === null || area === null) {
			return;
		}
		const snapshot = store.getSnapshot();
		const bounds =
			snapshot.selection === null ? null : normalize(snapshot.selection, snapshot.order);
		const corner =
			bounds === null
				? null
				: {
						filePath: snapshot.order.rows[bounds.bottom] ?? '',
						fieldId: snapshot.order.fields[bounds.right] ?? '',
					};
		const cell = corner === null ? null : queryCell(area, corner);
		if (cell === null || snapshot.editing !== null) {
			handle.classList.add('is-hidden');
			return;
		}
		const areaBox = area.getBoundingClientRect();
		const box = cell.getBoundingClientRect();
		// The token, not a literal: the handle's size is a design value and `tokens.css` owns it. Read at placement
		// (once per selection change or scroll frame), never in a render.
		const fillSize = readPxToken(area, '--tablify-fill-size', 9);
		handle.classList.remove('is-hidden');
		handle.style.transform = `translate(${String(box.right - areaBox.left - fillSize / 2)}px, ${String(
			box.bottom - areaBox.top - fillSize / 2,
		)}px)`;
	}, [store]);

	/**
	 * The scroll frame needs the placer, and the frame is set up before it (the frame owns the window, the window
	 * feeds the lanes, the lanes decide where the corner is). One ref closes that loop without reordering a hundred
	 * lines of layout code: the frame calls "whatever the latest placer is".
	 */
	placeFillHandleRef.current = placeFillHandle;

	const selectionRevision = useSelectionRevision(store);
	useLayoutEffect(() => {
		placeFillHandle();
	}, [placeFillHandle, selectionRevision, activeKey, focusTick]);

	/* ── the menus ─────────────────────────────────────────────────────────────────────────────────────── */

	/** The row actions the view owns, defaulted to "this view cannot do that" — see `GridViewProps.rows`. */
	const rowPorts = props.rows ?? { onInsertRow: null, onDuplicateRows: null, onDeleteRows: null };
	const rowsRef = useRef(rowPorts);
	rowsRef.current = rowPorts;

	/** A note-shaped summary of a row, in the grid's own dialog (`RowDetailsDialog`). */
	const openRowDetails = useCallback(
		(filePath: RowId): void => {
			dialogsRef.current?.rowDetails({ store, filePath });
		},
		[store],
	);

	const openFieldDialog = useCallback(
		(id: GridDialogId, argument?: string): void => {
			const port = dialogsRef.current;
			if (port === null) {
				return;
			}
			if (id === 'view-options') {
				port.viewOptions({
					store,
					presentation,
					// Measured at the moment the dialog opens: the freeze row follows the *pane*, and a pane that
					// was resized since the last render is the case §P21 is about.
					paneWidth: paneWidthOf(areaRef.current),
					onPresentation: (patch) => {
						onPresentationRef.current?.(patch);
					},
				});
				return;
			}
			if (argument === undefined) {
				return;
			}
			if (id === 'field-config') {
				port.fieldConfig({ store, fieldId: argument });
				return;
			}
			port.optionManager({ store, fieldId: argument });
		},
		[store, presentation],
	);

	/**
	 * The bulk-edit prompt: `Cmd/Ctrl+Enter`'s dialog half. It is one `Modal` with a text field, and the value it
	 * collects goes to every cell of the range through {@link applyBulkEditDraft} — which parses the text with the
	 * column's own descriptor (exactly what the dialog's hint promises), writes bottom-up, and lands as one
	 * `setCells` op: one batch, one undo step.
	 */
	const openBulkEdit = useCallback((): void => {
		const port = dialogsRef.current;
		const ref = store.getSnapshot().active;
		port?.bulkEdit({
			store,
			fieldId: ref?.fieldId ?? '',
			onApply: (value) => {
				applyBulkEditDraft(store, value, ref?.fieldId ?? '');
			},
		});
	}, [store]);

	/**
	 * The scroll frame needs the placer, and the frame is set up before it (the frame owns the window, the window
	 * feeds the lanes, the lanes decide where the corner is). One ref closes that loop without reordering a hundred
	 * lines of layout code: the frame calls "whatever the latest placer is".
	/** The ports every menu item needs, gathered once per open. */
	const menuPorts = useCallback(
		(): GridMenuPorts => ({
			onRowDetails: openRowDetails,
			onBulkEdit: openBulkEdit,
			onInsertRow: rowsRef.current.onInsertRow,
			onDuplicateRows: rowsRef.current.onDuplicateRows,
			onDeleteRows: rowsRef.current.onDeleteRows,
			onDialog: openFieldDialog,
			onCopy: (verb) => {
				void copySelection(verb);
			},
			onPaste: pasteFromClipboard,
			onSelectRows: (paths) => {
				for (const path of paths) {
					// A range over whole rows: the selection the gutter's own checkbox makes.
					const range = rowRange(path, store.getSnapshot().order);
					if (range !== null) {
						setSelection(store, range);
					}
				}
			},
		}),
		[openRowDetails, openBulkEdit, openFieldDialog, store, copySelection, pasteFromClipboard],
	);

	/** Opens the header menu at the pointer (a header click, or a right-click on a header). */
	const openHeaderMenu = useCallback(
		(fieldId: PropertyId, event: MouseEvent): void => {
			const field = fieldOf(store, fieldId);
			if (field === null) {
				return;
			}
			const snapshot = store.getSnapshot();
			const anchor = { kind: 'event', event } as const;
			showMenu(
				headerMenuItems({
					store,
					field,
					columnIndex: snapshot.order.fields.indexOf(fieldId),
					order: snapshot.order,
					bounds: menuBounds(snapshot.order, snapshot.selection, snapshot.active),
					ports: menuPorts(),
				}),
				anchor,
			);
		},
		[store, menuPorts],
	);

	/** Right-click (or a long press, which the browser reports as a context menu) anywhere in the grid. */
	const onContextMenu = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>): void => {
			const node = event.target;
			if (!(node instanceof Element)) {
				return;
			}
			const snapshot = store.getSnapshot();
			event.preventDefault();
			const header = node.closest('.hcell[data-field]');
			if (header !== null) {
				const fieldId = header.getAttribute('data-field');
				if (fieldId !== null) {
					openHeaderMenu(fieldId, event.nativeEvent);
					return;
				}
			}
			const cell = node.closest('[data-cell]');
			if (cell !== null) {
				const key = cell.getAttribute('data-cell');
				const at = key === null ? null : splitCellKey(key);
				if (at !== null) {
					const field = fieldOf(store, at.fieldId);
					showMenu(
						cellMenuItems({
							store,
							filePath: at.filePath,
							field,
							bounds: menuBounds(snapshot.order, snapshot.selection, snapshot.active),
							ports: menuPorts(),
						}),
						{ kind: 'event', event: event.nativeEvent },
					);
					return;
				}
			}
			const row = node.closest('[data-row]');
			const filePath = row?.getAttribute('data-row');
			if (filePath !== null && filePath !== undefined) {
				const selected = snapshot.order.rows.filter((path) =>
					(snapshot.selection === null
						? []
						: cellsOf(snapshot.selection, snapshot.order)
					).some((candidate) => candidate.filePath === path),
				);
				showMenu(
					gutterMenuItems({
						store,
						filePath,
						paths: selected.length === 0 ? [filePath] : selected,
						bounds: menuBounds(snapshot.order, snapshot.selection, snapshot.active),
						ports: menuPorts(),
					}),
					{ kind: 'event', event: event.nativeEvent },
				);
			}
		},
		[store, openHeaderMenu, menuPorts],
	);

	/* ── the pointer ───────────────────────────────────────────────────────────────────────────────────── */

	/**
	 * The live width preview: a drag writes to the DOM, not to the store.
	 *
	 * `docs/04` §The layout contract's own rule ("the scroll frame writes transforms; a gesture writes the thing
	 * it is dragging") and the reason is the same in both cases — 60 `resizeColumn` commands for one drag would be
	 * 60 undo steps for one gesture, and every one of them would re-render every cell in the column. The store
	 * hears about the drag once, on release.
	 */
	const previewColumnWidth = useCallback((fieldId: PropertyId, width: number): void => {
		const root = rootRef.current;
		if (root === null) {
			return;
		}
		for (const element of offsetsOf(root.ownerDocument, fieldId)) {
			element.style.width = `${String(width)}px`;
		}
	}, []);

	/**
	 * The live preview's undo. Re-rendering is what restores a column's width — the styles React owns are the
	 * truth, so the drag's inline styles are all that has to go.
	 */
	const retreatFromPreview = useCallback((fieldId: PropertyId): void => {
		const root = rootRef.current;
		if (root === null) {
			return;
		}
		for (const element of offsetsOf(root.ownerDocument, fieldId)) {
			element.style.removeProperty('width');
		}
	}, []);

	/**
	 * The drop indicator, painted straight onto the two elements that can show it. A ref holds what is painted so
	 * clearing is one class removal rather than a query over every header cell on every move — and so the row
	 * reorder stays at **zero React renders per pointer move**, which is a property the tests assert.
	 */
	const paintedIndicatorRef = useRef<readonly HTMLElement[]>([]);
	const paintIndicator = useCallback(
		(targets: readonly HTMLElement[], className: string): void => {
			for (const element of paintedIndicatorRef.current) {
				element.classList.remove('is-drop-before', 'is-drop-after');
			}
			paintedIndicatorRef.current = targets;
			for (const element of targets) {
				element.classList.add(className);
			}
		},
		[],
	);
	const clearIndicator = useCallback((): void => {
		paintIndicator([], 'is-drop-before');
	}, [paintIndicator]);

	/** The fill handle's live preview: a class per cell the release would write. */
	const paintedFillRef = useRef<readonly HTMLElement[]>([]);
	const previewFill = useCallback((writes: readonly CellWrite[] | null): void => {
		const doc = rootRef.current?.ownerDocument;
		if (doc === undefined) {
			return;
		}
		for (const element of paintedFillRef.current) {
			element.classList.remove('is-fill-preview');
		}
		const next: HTMLElement[] = [];
		for (const write of writes ?? []) {
			const cell = doc.querySelector<HTMLElement>(
				`[data-cell="${write.filePath}::${write.fieldId}"]`,
			);
			if (cell !== null) {
				cell.classList.add('is-fill-preview');
				next.push(cell);
			}
		}
		paintedFillRef.current = next;
	}, []);

	/** Starts a resize from a header edge. */
	const startColumnResize = useCallback(
		(element: HTMLElement, fieldId: PropertyId, event: PointerEvent): void => {
			const field = store
				.getSnapshot()
				.fields.find((candidate) => candidate.definition.id === fieldId);
			if (field === undefined) {
				return;
			}
			beginColumnResize({
				element,
				fieldId,
				startWidth: store.getSnapshot().widths.get(fieldId) ?? DEFAULT_COLUMN_WIDTH,
				event,
				onPreview: previewColumnWidth,
				onCommit: (id, width) => {
					resizeColumn(store, id, width);
				},
				onCancel: () => {
					retreatFromPreview(fieldId);
				},
			});
		},
		[store, previewColumnWidth, retreatFromPreview],
	);

	/** Starts a header reorder — and, if the press never moved, opens the header menu where it was pressed. */
	const startColumnReorder = useCallback(
		(element: HTMLElement, fieldId: PropertyId, event: PointerEvent): void => {
			beginColumnReorder({
				element,
				fieldId,
				event,
				order: store.getSnapshot().order.fields,
				columnAt: (x, y) => columnAtPoint(element.ownerDocument, x, y),
				onIndicator: (target) => {
					if (target === null) {
						clearIndicator();
						return;
					}
					const doc = element.ownerDocument;
					paintIndicator(
						Array.from(
							doc.querySelectorAll<HTMLElement>(`[data-field="${target.fieldId}"]`),
						),
						target.side === 'before' ? 'is-drop-before' : 'is-drop-after',
					);
				},
				onCommit: (id, to) => {
					reorderColumn(store, id, to);
				},
				onClick: (pressed) => {
					openHeaderMenu(fieldId, pressed);
				},
			});
		},
		[store, paintIndicator, clearIndicator, openHeaderMenu],
	);

	/** Starts a row reorder from the gutter handle — the audit's drop targets and all. */
	const startRowReorder = useCallback(
		(element: HTMLElement, filePath: RowId, event: PointerEvent): void => {
			beginRowReorder({
				element,
				filePath,
				event,
				order: store.getSnapshot().order.rows,
				rowAt: (x, y) => rowAtPoint(element.ownerDocument, x, y),
				onIndicator: (target) => {
					if (target === null) {
						clearIndicator();
						return;
					}
					const doc = element.ownerDocument;
					paintIndicator(
						Array.from(
							doc.querySelectorAll<HTMLElement>(`[data-row="${target.filePath}"]`),
						),
						target.half === 'before' ? 'is-drop-before' : 'is-drop-after',
					);
				},
				onCommit: (path, to) => {
					moveRowTo(store, path, to);
				},
			});
		},
		[store, paintIndicator, clearIndicator],
	);

	/** Starts a fill drag from the handle at the selection's corner. */
	const startFillDrag = useCallback(
		(element: HTMLElement, event: PointerEvent): void => {
			const snapshot = store.getSnapshot();
			const selection = snapshot.selection;
			if (selection === null) {
				return;
			}
			beginFillDrag({
				element,
				event,
				selection,
				order: snapshot.order,
				cellAt: (x, y) => cellAtPoint(element.ownerDocument, x, y),
				valueOf: (filePath, fieldId) =>
					store.state().table.rows.find((row) => row.filePath === filePath)?.cells[
						fieldId
					] ?? null,
				onPreview: previewFill,
				onCommit: (plan) => {
					// One `setCells`: the whole drag is one undo step (the property the step asks to assert).
					setCells(
						store,
						plan.writes,
						`Fill ${plan.direction} ${String(plan.writes.length)} cell(s)`,
					);
					// The extended range becomes the selection, which is what the person just drew.
					setSelection(store, plan.target);
				},
			});
		},
		[store, previewFill],
	);

	/**
	 * Starts a range drag from the cell under the press. The cell's own `pointerdown` has already moved the
	 * active cell (and, with Shift held, set the range's focus), so the drag needs nothing from the event but a
	 * pointer and the anchor the range started from — the selection as it stands *after* that press.
	 *
	 * Auto-scrolling past the pane's edge is the reason this is not step 20's `dragSession`: see the header of
	 * `src/grid/selection/dragSelect.ts`.
	 */
	const startCellRangeDrag = useCallback((): void => {
		const scroller = scrollerRef.current;
		if (scroller === null) {
			return;
		}
		const selection = store.getSnapshot().selection;
		if (selection === null) {
			return;
		}
		const anchor = selection.anchor;
		startRangeDrag({
			doc: scroller.ownerDocument,
			scroller,
			cellAt: (x, y) => cellAtPoint(scroller.ownerDocument, x, y),
			onExtend: (ref) => {
				setSelection(store, { anchor, focus: ref });
			},
		});
	}, [store]);

	/** Starts a scroll-thumb drag, or pages the track when the press missed the thumb. */
	const startScrollDrag = useCallback(
		(axis: 'x' | 'y', element: HTMLElement, event: PointerEvent): void => {
			const scroller = scrollerRef.current;
			if (scroller === null) {
				return;
			}
			const track = axis === 'x' ? hbarRef.current : vbarRef.current;
			const trackLength =
				track === null ? 0 : axis === 'x' ? track.clientWidth : track.clientHeight;
			const viewLength = axis === 'x' ? scroller.clientWidth : scroller.clientHeight;
			const contentLength = axis === 'x' ? scroller.scrollWidth : scroller.scrollHeight;
			const startOffset = axis === 'x' ? scroller.scrollLeft : scroller.scrollTop;
			const geometry = thumbGeometry({ trackLength, viewLength, contentLength });
			beginScrollDrag({
				element,
				event,
				axis,
				geometry,
				startOffset,
				onScroll: (offset) => {
					if (axis === 'x') {
						scroller.scrollLeft = offset;
					} else {
						scroller.scrollTop = offset;
					}
					// One frame's worth of the same work a real scroll does: the lanes and the thumbs follow.
					syncScroll({
						scrollLeft: scroller.scrollLeft,
						scrollTop: scroller.scrollTop,
					});
				},
			});
		},
		[syncScroll],
	);

	/** A press on a track *beside* the thumb pages one viewport towards the click (the prototype's `trackPage`). */
	const pageTrack = useCallback(
		(axis: 'x' | 'y', event: ReactPointerEvent<HTMLDivElement>): void => {
			const scroller = scrollerRef.current;
			const track = event.currentTarget;
			if (scroller === null) {
				return;
			}
			const trackLength = axis === 'x' ? track.clientWidth : track.clientHeight;
			const viewLength = axis === 'x' ? scroller.clientWidth : scroller.clientHeight;
			const contentLength = axis === 'x' ? scroller.scrollWidth : scroller.scrollHeight;
			const offset = axis === 'x' ? scroller.scrollLeft : scroller.scrollTop;
			const geometry = thumbGeometry({ trackLength, viewLength, contentLength });
			const thumb = axis === 'x' ? hthumbRef.current : vthumbRef.current;
			if (thumb === null) {
				return;
			}
			const trackBox = track.getBoundingClientRect();
			const thumbBox = thumb.getBoundingClientRect();
			const next = offsetForTrackClick({
				clientPos: axis === 'x' ? event.clientX : event.clientY,
				thumbStart:
					(axis === 'x' ? thumbBox.left - trackBox.left : thumbBox.top - trackBox.top) +
					(axis === 'x' ? trackBox.left : trackBox.top),
				thumbEnd:
					(axis === 'x'
						? thumbBox.right - trackBox.left
						: thumbBox.bottom - trackBox.top) +
					(axis === 'x' ? trackBox.left : trackBox.top),
				offset,
				maxOffset: geometry.maxOffset,
				viewLength,
			});
			if (next === null) {
				return;
			}
			if (axis === 'x') {
				scroller.scrollLeft = next;
			} else {
				scroller.scrollTop = next;
			}
			syncScroll({ scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop });
		},
		[syncScroll],
	);

	/**
	 * One delegated `pointerdown` for every drag the grid has.
	 *
	 * Delegation rather than a handler per element, for the reason the keyboard uses one listener: rows are
	 * windowed and a handler per row is a listener per row that has to be cleaned up per unmount. The dispatch is
	 * by `closest()`, in the order the elements nest — the resize edge lives *inside* the header cell, and the
	 * fill handle *inside* a cell, so the innermost target has to win.
	 */
	const onRootPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>): void => {
			const node = event.target;
			if (!(node instanceof Element)) {
				return;
			}
			const resize = node.closest('[data-resize]');
			if (resize instanceof HTMLElement) {
				const fieldId = resize.dataset['resize'];
				if (fieldId !== undefined) {
					startColumnResize(resize, fieldId, event.nativeEvent);
					return;
				}
			}
			const rowHandle = node.closest('[data-row-drag]');
			if (rowHandle instanceof HTMLElement) {
				const filePath = rowHandle.dataset['rowDrag'];
				if (filePath !== undefined) {
					startRowReorder(rowHandle, filePath, event.nativeEvent);
					return;
				}
			}
			const fill = node.closest('[data-fill]');
			if (fill instanceof HTMLElement) {
				event.preventDefault();
				startFillDrag(fill, event.nativeEvent);
				return;
			}
			const thumb = node.closest('[data-thumb]');
			if (thumb instanceof HTMLElement) {
				event.preventDefault();
				startScrollDrag(
					thumb.dataset['thumb'] === 'x' ? 'x' : 'y',
					thumb,
					event.nativeEvent,
				);
				return;
			}
			const header = node.closest('[data-field]');
			if (header instanceof HTMLElement && node.closest('.hcell') === header) {
				const fieldId = header.dataset['field'];
				if (fieldId === undefined) {
					return;
				}
				/*
				 * **Shift+press on a header selects the whole column.** A plain press starts the reorder drag, and
				 * a plain press that never moves opens the header menu (asserted in `tests/dom/pointer.test.tsx`),
				 * so the column selection needs a modifier of its own — and the prototype left exactly this one
				 * free: `prototype/js/grid.js` §mousedown reads
				 * `if (e.button === 0 && !e.shiftKey) beginColumnDrag(...)`, with no branch for the Shift case.
				 */
				if (event.shiftKey) {
					event.preventDefault();
					const range = columnRange(fieldId, store.getSnapshot().order);
					if (range !== null) {
						setSelection(store, range);
					}
					return;
				}
				startColumnReorder(header, fieldId, event.nativeEvent);
				return;
			}
			/*
			 * A press on a cell: the range drag. On a fine pointer it always runs — dragging across cells is how a
			 * range is made with a mouse. On a coarse one it runs only in the **Select range** mode, because a
			 * finger drag on the grid is how you scroll (`docs/04` §Touch), and because the mode's whole reason to
			 * exist is that a scroll and a selection gesture cannot both be a drag.
			 */
			if (
				event.button === 0 &&
				(rangeSelect || !coarsePointer) &&
				node.closest('[data-cell]') !== null
			) {
				event.preventDefault();
				startCellRangeDrag();
			}
		},
		[
			startColumnResize,
			startRowReorder,
			startFillDrag,
			startScrollDrag,
			startColumnReorder,
			startCellRangeDrag,
			rangeSelect,
			coarsePointer,
			store,
		],
	);

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

	/**
	 * The touch range-selection mode (`docs/04` §Touch). It is view state rather than store state on purpose: it
	 * is a mode of the *gesture*, not of the table, and nothing about it is undoable or written anywhere. The
	 * drag that reads it lives in `onRootPointerDown`.
	 */
	const onToggleRangeSelect = useCallback((): void => {
		setRangeSelect((on) => !on);
	}, []);

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
			left: `${String(pinnedInset)}px`,
			transform: `translateY(${String(rowWindow.offsetY)}px)`,
		}),
		[headerHeight, rowWindow.offsetY, pinnedInset],
	);
	const headerStyle = useMemo<CSSProperties>(
		() => ({ left: `${String(pinnedInset)}px` }),
		[pinnedInset],
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
			// One delegated press for every drag (step 20): a per-row or per-cell handler would be a listener per
			// row, and rows are windowed.
			onPointerDown={onRootPointerDown}
			// Right-click and long-press both arrive here. The grid's own menus are built from data
			// (`src/grid/menus/`) and shown through Obsidian's `Menu`.
			onContextMenu={onContextMenu}
		>
			<Toolbar
				store={store}
				initialPaneWidth={initialPaneWidth}
				rangeSelect={rangeSelect}
				onToggleRangeSelect={onToggleRangeSelect}
				{...(onNewRow === undefined ? {} : { onNewRow })}
			/>

			<div className="tablify-grid-area" ref={areaRef}>
				{/*
				 * The fill handle. It is a *drag* affordance and is therefore hidden from assistive technology
				 * (`aria-hidden`): the equivalent action is `Alt+D` / `Alt+R` on a selection, and the cell menu's
				 * `Fill down` / `Fill right`, both of which are announced. Positioned by measurement, not by CSS:
				 * the corner cell's box is read once per placement (see `placeFillHandle`).
				 */}
				<div className="tablify-fill" ref={fillRef} data-fill="corner" aria-hidden="true" />
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

				<div
					className="tablify-layer tablify-header"
					ref={headerLayerRef}
					style={headerStyle}
				>
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
				<div
					className="tablify-hbar"
					ref={hbarRef}
					aria-hidden="true"
					onPointerDown={(event) => {
						pageTrack('x', event);
					}}
				>
					<div
						className="tablify-hbar-thumb"
						ref={hthumbRef}
						data-thumb="x"
						role="presentation"
					/>
				</div>
				<div
					className="tablify-vbar"
					ref={vbarRef}
					aria-hidden="true"
					onPointerDown={(event) => {
						pageTrack('y', event);
					}}
				>
					<div
						className="tablify-vbar-thumb"
						ref={vthumbRef}
						data-thumb="y"
						role="presentation"
					/>
				</div>
			</div>

			<StatusBar store={store} />

			{/* One polite live region for the whole grid, mounted for the life of the view: it is the *change* in a
			    live region that a screen reader announces, so a region re-created per render announces nothing. */}
			<LiveRegion message={pasteMessage === '' ? announcement : pasteMessage} />
		</div>
	);
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
