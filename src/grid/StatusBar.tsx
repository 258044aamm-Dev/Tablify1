/**
 * The status bar: what is selected, how many rows the query kept, and whether anything is still being written.
 *
 * It is one of the few surfaces allowed to read the whole snapshot (`docs/02` §Store: the toolbar, the status
 * bar and the empty state). Even so it reads **three numbers**, not the snapshot: `selectStatusSummary` is
 * computed per call and the hook compares by value, so a keystroke that changes the pending count re-renders
 * this line and nothing else in it.
 */
import type { ReactElement } from 'react';

import { selectStatusSummary } from './store/selectors';
import { useStoreSelector } from './store/selectors';
import type { GridStore } from './store/types';

export type StatusBarProps = {
	readonly store: GridStore;
};

/** The exact wording, in one place, so a test can assert the sentence rather than three fragments. */
export function statusLine(summary: {
	readonly visibleRows: number;
	readonly totalRows: number;
	readonly selectedRows: number;
	readonly selectedCells: number;
	readonly pending: number;
	readonly busy: boolean;
}): string {
	const parts: string[] = [];
	parts.push(
		summary.visibleRows === summary.totalRows
			? `${String(summary.visibleRows)} rows`
			: `${String(summary.visibleRows)} of ${String(summary.totalRows)} rows`,
	);
	if (summary.selectedCells > 1) {
		parts.push(
			`${String(summary.selectedCells)} cells in ${String(summary.selectedRows)} rows selected`,
		);
	} else if (summary.selectedCells === 1) {
		parts.push('1 cell selected');
	}
	if (summary.busy) {
		parts.push('writing…');
	} else if (summary.pending > 0) {
		parts.push(`${String(summary.pending)} pending`);
	}
	return parts.join(' · ');
}

export function StatusBar(props: StatusBarProps): ReactElement {
	const { store } = props;
	const summary = useStoreSelector(store, selectStatusSummary, sameSummary);
	return (
		/*
		 * **Not a live region** (step 27's accessibility pass; regression guard in `tests/dom/a11y.test.ts`).
		 *
		 * This line reads `40 rows · 3 cells in 2 rows selected · 1 pending`, so an implied `aria-live="polite"`
		 * would make a screen reader announce the selection count on *every* arrow key and shift-click — the
		 * grid interrupting itself while it is being navigated. `role="status"` implies exactly that, so the
		 * summary is a named group instead: readable on demand, silent otherwise.
		 *
		 * The one polite announcement the product promises (`docs/04` §Accessibility, *"412 cells updated in 137
		 * notes"*) is `a11y/roles.tsx`'s `LiveRegion`, which is mounted once by `GridView` and changes only when
		 * something has actually been written to the vault. The empty state keeps its own `role="status"`
		 * (`Empty.tsx`) for the opposite reason: that text appears once, as the answer to a filter.
		 */
		<div className="tablify-statusbar" role="group" aria-label="Grid status">
			<span className="tablify-status">{statusLine(summary)}</span>
		</div>
	);
}

/** Field-by-field, because `selectStatusSummary` builds a fresh object and `Object.is` would never match. */
function sameSummary(
	previous: ReturnType<typeof selectStatusSummary>,
	next: ReturnType<typeof selectStatusSummary>,
): boolean {
	return (
		previous.visibleRows === next.visibleRows &&
		previous.totalRows === next.totalRows &&
		previous.selectedRows === next.selectedRows &&
		previous.selectedFields === next.selectedFields &&
		previous.selectedCells === next.selectedCells &&
		previous.pending === next.pending &&
		previous.busy === next.busy
	);
}
