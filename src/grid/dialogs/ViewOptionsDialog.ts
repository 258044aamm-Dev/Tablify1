/**
 * View options: the view's own settings, as one dialog.
 *
 * This is the prototype's `.tablify-dlg` view panel (`prototype/js/dialogs.js` §viewPanel), rebuilt as a `Modal`,
 * and the split between the two halves of it is the architecture in miniature:
 *
 *  · **Sort, group-by and column visibility are the *view's* config**, which lives in the `.base` sidecar
 *    (`docs/03` §the sidecar). They go through `setViewConfig` — one undoable step each, no dialog-local state.
 *  · **Density and freezing the primary column are *presentation***, which the host owns and passes down: the
 *    grid renders with whatever it is given (`resolvePresentation`), so a change is reported up with
 *    {@link ViewOptionsInput.onPresentation} rather than written into the store. There is no `density` op, and
 *    inventing one would put a pixel value in the undo history.
 *
 * **The freeze switch is hidden below the pinning threshold**, not disabled. That is `docs/08` §P21 as the human
 * amended it for mobile: pinning is a wide-pane affordance, so on a 389 px pane a switch that cannot do anything
 * is noise — the doc's own wording is "hidden, not greyed out".
 */
import { setViewConfig } from '../store/commands';
import { NARROW_PANE_PX } from '../layout';
import { isPrimary } from '../menus/context';
import { openDialog } from './base';
import type { DialogSpec } from './base';
import type { App } from 'obsidian';
import type { GridPresentation } from '../layout';
import type { GridStore } from '../store/types';
import type { GridModal } from './base';

export type ViewOptionsInput = {
	readonly store: GridStore;
	/** The presentation the grid is currently rendering with — `resolvePresentation`'s answer, not the patch. */
	readonly presentation: GridPresentation;
	/** The pane's width, so the freeze row can follow §P21 rather than the device. */
	readonly paneWidth: number;
	/**
	 * Reports a presentation change to whoever mounts the grid. The dialog does not keep the value: the next
	 * render's `presentation` prop is the truth, which is what keeps one number with one owner.
	 */
	readonly onPresentation: (patch: Partial<GridPresentation>) => void;
	readonly onClosed?: (() => void) | undefined;
};

/** The three densities, in the order the dialog lists them — coolest to roomiest. */
const DENSITIES: readonly GridPresentation['density'][] = ['short', 'medium', 'tall'];

/** `'short' | 'medium' | 'tall'` from a `<select>`'s string, or `null` for a value the grid does not know. */
export function toDensity(value: string): GridPresentation['density'] | null {
	return value === 'short' || value === 'medium' || value === 'tall' ? value : null;
}

/** One labelled row, with the control built by the caller. */
function row(host: HTMLElement, label: string): HTMLElement {
	const line = host.createDiv({ cls: 'tablify-dlg-row' });
	line.createSpan({ cls: 'tablify-dlg-row-label', text: label });
	return line;
}

export function viewOptionsSpec(input: ViewOptionsInput): DialogSpec {
	const { store, presentation, paneWidth, onPresentation, onClosed } = input;
	const snapshot = store.getSnapshot();
	// The view's own options are `GridState.view` (`docs/02`: the store keeps the view beside the table), while
	// the columns come from the snapshot. Two sources because they change for different reasons.
	const view = store.state().view;
	const pinnedAvailable = paneWidth >= NARROW_PANE_PX;

	return {
		kind: 'dialog',
		title: 'View options',
		subtitle: 'These settings belong to this view. Rows and columns are the notes themselves.',
		...(onClosed === undefined ? {} : { onClosed }),
		body: ({ contentEl }) => {
			/* ── sort ─────────────────────────────────────────────────────────────────────────────────────── */
			contentEl.createDiv({ cls: 'tablify-dlg-section', text: 'Sort' });
			const sorts = view.sorts ?? [];
			if (sorts.length === 0) {
				contentEl.createDiv({
					cls: 'tablify-dlg-hint',
					text: 'The rows are in the view’s own order.',
				});
			}
			for (const sort of sorts) {
				const name = snapshot.fields.find((field) => field.definition.id === sort.fieldId)
					?.definition.name;
				const line = row(
					contentEl,
					`${name ?? sort.fieldId} — ${sort.direction === 'asc' ? 'ascending' : 'descending'}`,
				);
				const remove = line.createEl('button', { cls: 'tablify-dlg-btn', text: 'Remove' });
				remove.addEventListener('click', () => {
					// Identity is the column, not an id: `SortSpec` is `{ fieldId, direction }` (`docs/02`), and a
					// column appears in a chain at most once.
					setViewConfig(
						store,
						{ sorts: sorts.filter((candidate) => candidate.fieldId !== sort.fieldId) },
						'Remove sort',
					);
					// One click, one command: the row is not removed from the DOM twice, and a second click on a
					// button whose sort is already gone would be a no-op command (the store would refuse it).
					remove.disabled = true;
				});
			}

			/* ── grouping ─────────────────────────────────────────────────────────────────────────────────── */
			contentEl.createDiv({ cls: 'tablify-dlg-section', text: 'Group' });
			const groupLine = row(contentEl, 'Group by');
			const select = groupLine.createEl('select', { cls: 'tablify-dlg-select' });
			select.createEl('option', { value: '', text: 'Nothing' });
			for (const field of snapshot.fields) {
				select.createEl('option', {
					value: field.definition.id,
					text: field.definition.name,
				});
			}
			select.value = view.groupBy ?? '';
			select.addEventListener('change', () => {
				const next = select.value === '' ? undefined : select.value;
				setViewConfig(
					store,
					{ groupBy: next },
					next === undefined ? 'Stop grouping' : 'Group by this field',
				);
			});

			/* ── columns ──────────────────────────────────────────────────────────────────────────────────── */
			contentEl.createDiv({ cls: 'tablify-dlg-section', text: 'Columns' });
			const hidden = new Set(view.hiddenFieldIds ?? []);
			for (const field of snapshot.fields) {
				const line = row(contentEl, field.definition.name);
				const toggle = line.createEl('input', {
					cls: 'tablify-dlg-switch',
					type: 'checkbox',
				});
				toggle.checked = !hidden.has(field.definition.id);
				if (isPrimary(field)) {
					// The primary column names each row's note; hiding it would leave rows with no name at all.
					toggle.disabled = true;
					toggle.title = 'The primary column cannot be hidden';
				}
				toggle.addEventListener('change', () => {
					const next = new Set<string>(hidden);
					if (toggle.checked) {
						next.delete(field.definition.id);
					} else {
						next.add(field.definition.id);
					}
					setViewConfig(
						store,
						{ hiddenFieldIds: [...next] },
						toggle.checked ? 'Show column' : 'Hide column',
					);
				});
			}

			/* ── rows ─────────────────────────────────────────────────────────────────────────────────────── */
			contentEl.createDiv({ cls: 'tablify-dlg-section', text: 'Rows' });
			const densityLine = row(contentEl, 'Row height');
			const density = densityLine.createEl('select', { cls: 'tablify-dlg-select' });
			for (const choice of DENSITIES) {
				density.createEl('option', { value: choice, text: choice });
			}
			density.value = presentation.density;
			density.addEventListener('change', () => {
				const next = toDensity(density.value);
				if (next !== null) {
					onPresentation({ density: next });
				}
			});

			if (pinnedAvailable) {
				const freezeLine = row(contentEl, 'Freeze the primary column');
				const freeze = freezeLine.createEl('input', {
					cls: 'tablify-dlg-switch',
					type: 'checkbox',
				});
				freeze.checked = presentation.frozenPrimary;
				freeze.addEventListener('change', () => {
					onPresentation({ frozenPrimary: freeze.checked });
				});
			} else {
				contentEl.createDiv({
					cls: 'tablify-dlg-hint',
					text: `This pane is ${String(paneWidth)} px wide, so nothing is pinned: freezing a column needs ${String(NARROW_PANE_PX)} px or more.`,
				});
			}
		},
		primary: { label: 'Done', run: () => undefined },
	};
}

/** Opens the dialog {@link viewOptionsSpec} describes — build, open, done. */
export function openViewOptionsDialog(app: App, input: ViewOptionsInput): GridModal {
	return openDialog(app, viewOptionsSpec(input));
}
