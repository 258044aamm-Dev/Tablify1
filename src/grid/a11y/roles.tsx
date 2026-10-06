/**
 * The accessibility wiring, in one place: the roles, the `aria-*` attributes, and the live region.
 *
 * `docs/04` §Accessibility is unusually specific about this grid, and every line of it is a decision rather
 * than a nicety:
 *
 *  · **`aria-activedescendant` is not used; real focus moves.** So the roving `tabindex` (`keyboard/focus.ts`)
 *    and these roles are two halves of one mechanism: a cell that is part of a range has
 *    `aria-selected="true"`, and the cell that *has focus* is the one a screen reader is reading.
 *  · **Indices count virtualized-but-absent cells.** `aria-rowindex`/`aria-colindex` are the row's and the
 *    column's position in the whole view, not in the mounted window — which is what makes a 5,000-row grid
 *    navigable by a screen reader that can only see nine rows of DOM.
 *  · **Read-only cells say so**: `aria-readonly="true"` plus a `title` explaining why (`docs/01` §Editing:
 *    *disabled cells with a tooltip, never as editable inputs that silently discard input*).
 *  · **Bulk operations are announced politely.** `docs/04`: *"Announce completion via a polite live region:
 *    '412 cells updated in 137 notes'"*. The region is rendered **once** and stays mounted, because a live
 *    region that is re-created on every render announces nothing at all — the change is what a screen reader
 *    reads, and a fresh node has no change to report.
 *
 * Builders rather than literals: every component that carries a role takes it from here, so "the grid is one
 * grid with rows and cells" is a fact about this file rather than a convention four files happen to follow.
 */
import type { ReactElement } from 'react';

export type GridRoleProps = {
	readonly label: string;
	/** The view's total rows, including the ones no element exists for. */
	readonly rowCount: number;
	readonly columnCount: number;
};

export function gridRoleProps(input: GridRoleProps): {
	role: 'grid';
	'aria-label': string;
	'aria-rowcount': number;
	'aria-colcount': number;
} {
	return {
		role: 'grid',
		'aria-label': input.label,
		'aria-rowcount': input.rowCount,
		'aria-colcount': input.columnCount,
	};
}

export type RowRoleProps = {
	/** One-based, counting collapsed groups out — the row's place in the *view*. */
	readonly rowIndex: number;
	readonly selected: boolean;
};

export function rowRoleProps(input: RowRoleProps): {
	role: 'row';
	'aria-rowindex': number;
	'aria-selected': boolean;
} {
	return { role: 'row', 'aria-rowindex': input.rowIndex + 1, 'aria-selected': input.selected };
}

export type CellRoleProps = {
	readonly rowIndex: number;
	readonly columnIndex: number;
	readonly selected: boolean;
	readonly readOnly: boolean;
};

/** `aria-colindex` is one-based for the same reason `aria-rowindex` is: the DOM window is not the grid. */
/** One flat shape with optional read-only fields, so a component can spread it without narrowing anything. */
export type CellRoleAttributes = {
	readonly role: 'gridcell';
	readonly 'aria-rowindex': number;
	readonly 'aria-colindex': number;
	readonly 'aria-selected': boolean;
	readonly 'aria-readonly'?: true;
	readonly title?: string;
};

export function cellRoleProps(input: CellRoleProps): CellRoleAttributes {
	return input.readOnly
		? {
				...cellAttributes(input),
				'aria-readonly': true,
				title: 'This column is read-only',
			}
		: cellAttributes(input);
}

function cellAttributes(input: CellRoleProps): CellRoleAttributes {
	return {
		role: 'gridcell',
		'aria-rowindex': input.rowIndex + 1,
		'aria-colindex': input.columnIndex + 1,
		'aria-selected': input.selected,
	};
}

export function columnHeaderProps(
	columnIndex: number,
	label: string,
): {
	role: 'columnheader';
	'aria-colindex': number;
	'aria-label': string;
} {
	return { role: 'columnheader', 'aria-colindex': columnIndex + 1, 'aria-label': label };
}

/**
 * The one polite live region of the grid.
 *
 * It is mounted for the life of the view and only its text changes — that is the whole trick, and it is why
 * this is a component rather than a helper that writes into a node somebody else owns. `aria-atomic="true"`
 * makes a screen reader read the sentence rather than the diff: "412 cells updated in 137 notes" is one
 * statement, and hearing only the changed digits would be worse than hearing nothing.
 */
export function LiveRegion({ message }: { readonly message: string }): ReactElement {
	// An empty region is deliberate: the element stays, so the *next* message is a change in a live region that
	// has been there all along. Rendering it only when there is something to say is the classic mistake — the
	// screen reader never reads a region that was created together with its text.
	return (
		<div className="tablify-live" role="status" aria-live="polite" aria-atomic="true">
			{message}
		</div>
	);
}

/** What {@link announcementOf} needs of the snapshot: the write report, and nothing else. */
export type AnnouncementInput = {
	readonly lastError: string | null;
	readonly lastApply: {
		readonly written: number;
		readonly files: readonly string[];
		readonly refused: readonly unknown[];
		readonly errors: readonly unknown[];
	} | null;
};

/**
 * The sentence the live region carries, derived from the write report the store already keeps.
 *
 * `docs/04` §Accessibility gives the shape: *"412 cells updated in 137 notes"*. The counts come from the apply
 * report rather than from a per-action counter, so the announcement describes what actually reached the files —
 * a refusal or a failed write is part of the same sentence instead of a silent difference between what the grid
 * shows and what the vault holds.
 */
export function announcementOf(input: AnnouncementInput): string {
	if (input.lastError !== null) {
		return `Write failed. ${input.lastError}`;
	}
	const apply = input.lastApply;
	if (apply === null) {
		return '';
	}
	const parts: string[] = [];
	if (apply.written > 0) {
		parts.push(
			`${count(apply.written, 'cell', 'cells')} updated in ${count(apply.files.length, 'note', 'notes')}`,
		);
	}
	if (apply.refused.length > 0) {
		parts.push(`${count(apply.refused.length, 'cell', 'cells')} read-only`);
	}
	if (apply.errors.length > 0) {
		parts.push(`${count(apply.errors.length, 'write', 'writes')} failed`);
	}
	return parts.join(', ');
}

/** `1 cell` / `412 cells`. One helper, so the live region and the toolbar cannot disagree about plurals. */
function count(value: number, one: string, many: string): string {
	return value === 1 ? `${String(value)} ${one}` : `${String(value)} ${many}`;
}
