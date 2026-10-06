/**
 * The dialogs, as a port the grid can hold without knowing Obsidian exists.
 *
 * `src/grid/**` may import `obsidian` in exactly two folders — `menus/` and `dialogs/` — and this file is the
 * hinge: {@link createDialogPort} is called once by whichever view has an `App` (`TablifyView`), and everything
 * outside those two folders deals only in {@link DialogPort}, a plain object of functions.
 *
 * Every opener records a **surface** in `src/grid/a11y/focusContract.ts` carrying the element that had focus, and
 * gives it back when the dialog closes. The order is the whole trick: the modal is *built* (which creates its
 * `contentEl` but takes no focus), the surface is recorded with that container and the current opener, and only
 * then is the dialog opened. Recording after `open()` would capture the dialog's own first field as the opener,
 * and the keyboard would end up inside the body element of a dialog that no longer exists.
 */
import { closeSurface, openSurface, openerOf } from '../a11y/focusContract';
import type { FocusSurface } from '../a11y/focusContract';
import { buildDialog } from './base';
import { bulkEditSpec } from './BulkEditDialog';
import { fieldConfigSpec } from './FieldConfigDialog';
import { optionManagerSpec } from './OptionManagerDialog';
import { rowDetailsSpec } from './RowDetailsDialog';
import { viewOptionsSpec } from './ViewOptionsDialog';
import type { App } from 'obsidian';
import type { DialogSpec } from './base';
import type { GridPresentation } from '../layout';
import type { GridStore } from '../store/types';
import type { PropertyId } from '../../core/types';
import type { RowId } from '../../core/ops/types';

export type DialogPort = {
	readonly viewOptions: (input: {
		readonly store: GridStore;
		readonly presentation: GridPresentation;
		readonly paneWidth: number;
		readonly onPresentation: (patch: Partial<GridPresentation>) => void;
	}) => void;
	readonly fieldConfig: (input: {
		readonly store: GridStore;
		readonly fieldId: PropertyId;
	}) => void;
	readonly optionManager: (input: {
		readonly store: GridStore;
		readonly fieldId: PropertyId;
	}) => void;
	readonly rowDetails: (input: { readonly store: GridStore; readonly filePath: RowId }) => void;
	/** One value, every cell of the selection — `Cmd/Ctrl+Enter`'s dialog half. */
	readonly bulkEdit: (input: {
		readonly store: GridStore;
		readonly fieldId: PropertyId;
		readonly onApply: (value: string | null) => void;
	}) => void;
};

/** Builds the port for one app. Called once per view, by the view. */
export function createDialogPort(app: App): DialogPort {
	/**
	 * Build, record, open — see the file header. `spec` is built by the caller's own function so the dialog's own
	 * module keeps ownership of the body.
	 */
	function tracked(spec: DialogSpec): void {
		const outer = spec.onClosed;
		let surface: FocusSurface | null = null;
		const modal = buildDialog(app, {
			...spec,
			onClosed: () => {
				// The dialog is really gone at this point: `Modal.onClose` is the hook the host calls after it has
				// finished with the element, and every dialog file forwards it from there.
				if (surface !== null) {
					closeSurface(surface);
				}
				outer?.();
			},
		});
		surface = openSurface('dialog', modal.contentEl, openerOf(document));
		modal.open();
	}

	return {
		viewOptions: (input) => {
			tracked(
				viewOptionsSpec({
					store: input.store,
					presentation: input.presentation,
					paneWidth: input.paneWidth,
					onPresentation: input.onPresentation,
				}),
			);
		},
		fieldConfig: (input) => {
			const field = input.store
				.getSnapshot()
				.fields.find((candidate) => candidate.definition.id === input.fieldId);
			if (field === undefined) {
				return;
			}
			tracked(fieldConfigSpec({ store: input.store, field }));
		},
		optionManager: (input) => {
			const field = input.store
				.getSnapshot()
				.fields.find((candidate) => candidate.definition.id === input.fieldId);
			if (field === undefined) {
				return;
			}
			tracked(optionManagerSpec({ store: input.store, field }));
		},
		rowDetails: (input) => {
			tracked(rowDetailsSpec({ store: input.store, filePath: input.filePath }));
		},
		bulkEdit: (input) => {
			tracked(
				bulkEditSpec({
					store: input.store,
					fieldId: input.fieldId,
					onApply: input.onApply,
				}),
			);
		},
	};
}
