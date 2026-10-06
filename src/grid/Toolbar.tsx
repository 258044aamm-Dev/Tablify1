/**
 * The toolbar: one row, never two (`docs/04` §The layout contract, §Mobile).
 *
 * It offers the three actions the grid can already honour — new row, undo, redo — plus the wordmark slot the
 * brand layer sizes. It deliberately does **not** invent the search box, the view menu or the import button:
 * those arrive with the surfaces that own them (steps 22–24), and a button that cannot do what it says is worse
 * than a button that is not there yet.
 *
 * **Below 520 px of toolbar, two of the three move into `⋯`.** `docs/04` §Touch asks for that collapse and
 * `docs/07` §Tier 4 asserts it; the threshold is the toolbar's own width, measured here, because a narrow pane
 * on a wide screen has the same problem as a phone. What moves is the *secondary* half — undo and redo, which
 * have keyboard bindings — and what stays is the primary action and the row count. The menu is built from
 * `src/grid/menus/toolbarMenu.ts` and shown through the same `showMenu` every other menu in the grid uses, so
 * there is one menu implementation and one place to add import/export to.
 *
 * The counts come from selectors, so the toolbar re-renders when the numbers change and not when a cell's value
 * does.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactElement, RefObject } from 'react';

import { redo, undo } from './store/commands';
import { useStore } from './store/selectors';
import { paneWidthOf } from './measure';
import { TOOLBAR_COLLAPSE_PX } from './layout';
import { useCoarsePointer } from './selection/dragSelect';
import { showMenu } from './menus/items';
import { toolbarMenuItems } from './menus/toolbarMenu';
import type { GridStore } from './store/types';

export type ToolbarProps = {
	readonly store: GridStore;
	/** Creates a note and adds it as a row. Absent when the host cannot create notes — see `GridView`. */
	readonly onNewRow?: (() => void) | undefined;
	/**
	 * The pane's width, measured by the view **before** the first mount. Handing it in is what keeps the first
	 * frame from painting three buttons and then taking one away — the same reason `GridView` takes it.
	 */
	readonly initialPaneWidth?: number | undefined;
	/**
	 * The touch range-selection mode, owned by the view (the drag that reads it is the view's).
	 *
	 * It is rendered **only on a coarse pointer**: `docs/04` §Touch gives this toggle a reason — a finger drag on
	 * the grid is how you scroll, so selecting a range has to be asked for — and on a mouse that reason does not
	 * exist, because the drag already selects. A button that appeared on the desktop would be a mode nobody has a
	 * use for.
	 */
	readonly rangeSelect?: boolean | undefined;
	readonly onToggleRangeSelect?: (() => void) | undefined;
};

/** True when the toolbar is too narrow for its own buttons: below `TOOLBAR_COLLAPSE_PX`, and only then. */
export function isCollapsed(width: number): boolean {
	return width > 0 && width < TOOLBAR_COLLAPSE_PX;
}

/**
 * The collapse decision as a hook that re-renders **only when the answer flips** — the same shape as
 * `usePinnedPrimary`, and for the same reason: a sidebar drag resizes the pane continuously and the answer
 * changes once in the whole gesture. An unmeasurable toolbar (jsdom, `display: none`) keeps the answer it was
 * handed rather than deciding on zero.
 */
function useCollapsed(toolbar: RefObject<HTMLElement | null>, initialWidth: number): boolean {
	const [collapsed, setCollapsed] = useState(() => isCollapsed(initialWidth));
	const current = useRef(collapsed);

	useEffect(() => {
		const element = toolbar.current;
		if (element === null || element === undefined) {
			return;
		}
		const evaluate = (): void => {
			const width = paneWidthOf(element);
			if (width <= 0) {
				return;
			}
			const next = isCollapsed(width);
			if (next !== current.current) {
				current.current = next;
				setCollapsed(next);
			}
		};
		evaluate();
		if (typeof ResizeObserver !== 'function') {
			return;
		}
		const observer = new ResizeObserver(evaluate);
		observer.observe(element);
		return () => {
			observer.disconnect();
		};
	}, [toolbar, initialWidth]);

	return collapsed;
}

export function Toolbar(props: ToolbarProps): ReactElement {
	const {
		store,
		onNewRow,
		initialPaneWidth = 0,
		rangeSelect = false,
		onToggleRangeSelect,
	} = props;
	const barRef = useRef<HTMLDivElement | null>(null);
	const collapsed = useCollapsed(barRef, initialPaneWidth);
	const coarse = useCoarsePointer();
	// The mode exists only where a drag would otherwise scroll, and only when the view can actually toggle it.
	const rangeToggle = coarse && onToggleRangeSelect !== undefined;
	const rows = useStore(store, (snapshot) => snapshot.rows.length);
	const canUndo = useStore(store, (snapshot) => snapshot.canUndo);
	const canRedo = useStore(store, (snapshot) => snapshot.canRedo);
	const undoLabel = useStore(store, (snapshot) => snapshot.undoLabel);

	const onUndo = useCallback((): void => {
		undo(store);
	}, [store]);
	const onRedo = useCallback((): void => {
		redo(store);
	}, [store]);
	const onOverflow = useCallback(
		(event: ReactMouseEvent<HTMLButtonElement>): void => {
			showMenu(
				toolbarMenuItems({
					canUndo,
					canRedo,
					undoLabel,
					onUndo,
					onRedo,
					onNewRow: onNewRow ?? null,
					rangeSelect: rangeToggle ? rangeSelect : null,
					onToggleRangeSelect: onToggleRangeSelect ?? (() => undefined),
				}),
				{ kind: 'event', event: event.nativeEvent },
			);
		},
		[
			canUndo,
			canRedo,
			undoLabel,
			onUndo,
			onRedo,
			onNewRow,
			rangeToggle,
			rangeSelect,
			onToggleRangeSelect,
		],
	);

	return (
		<div className="tablify-toolbar" role="toolbar" aria-label="Tablify toolbar" ref={barRef}>
			<span className="tablify-wordmark" aria-hidden="true" />
			{onNewRow === undefined ? null : (
				<button className="tablify-btn is-primary" type="button" onClick={onNewRow}>
					New row
				</button>
			)}
			{collapsed ? (
				<button
					className="tablify-btn"
					type="button"
					data-toolbar-overflow="true"
					aria-haspopup="menu"
					aria-label="More actions"
					title="More actions"
					onClick={onOverflow}
				>
					⋯
				</button>
			) : (
				<>
					<button
						className="tablify-btn"
						type="button"
						onClick={onUndo}
						disabled={!canUndo}
						title={undoLabel === null ? 'Nothing to undo' : `Undo ${undoLabel}`}
					>
						Undo
					</button>
					<button
						className="tablify-btn"
						type="button"
						onClick={onRedo}
						disabled={!canRedo}
						title="Redo"
					>
						Redo
					</button>
				</>
			)}
			{!collapsed && rangeToggle ? (
				<button
					className={`tablify-btn${rangeSelect ? ' is-on' : ''}`}
					type="button"
					aria-pressed={rangeSelect}
					title="Drag across cells to select a range instead of scrolling"
					onClick={onToggleRangeSelect}
				>
					Select range
				</button>
			) : null}
			<span className="tablify-toolbar-spacer" />
			<span className="tablify-count">{rows} rows</span>
		</div>
	);
}
