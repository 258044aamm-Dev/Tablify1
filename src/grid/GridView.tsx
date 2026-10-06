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
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

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
import { selectLaneItems, useStore } from './store/selectors';
import { clearSelection, selectCell, setSelection, toggleGroup } from './store/commands';
import { useWindow } from './useWindow';
import type { ScrollPosition } from './useWindow';
import { usePinnedPrimary } from './usePinnedPrimary';
import { windowSlice } from './store/window';
import { rowRange } from '../core/selection/range';
import type { GridPresentation } from './layout';
import type { GridStore } from './store/types';
import type { CellRef, RowId } from '../core/ops/types';
import type { LaneItem } from './store/selectors';

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
};

export function GridView(props: GridViewProps): ReactElement {
	const { store, presentation: patch, initialPaneWidth = 0, onNewRow, onClearFilters } = props;
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

	const pinned = usePinnedPrimary(areaRef, presentation.frozenPrimary, initialPaneWidth);

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

	const { window: rowWindow } = useWindow({
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
			role="grid"
			aria-label="Tablify grid"
			aria-rowcount={visibleRowCount}
			aria-colcount={columns.length}
			// The grid is one tab stop; the roving tabindex inside it is step 19's contract.
			tabIndex={-1}
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
		</div>
	);
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
