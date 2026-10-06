/**
 * `editorFor(field)` — the **only** place that maps a field to an editor component.
 *
 * The mapping is not a `switch` on the type, because the type is not the right key: a field descriptor already
 * declares the editor it wants (`FieldDescriptor.editor`, `src/core/fieldTypes/*`), and several types
 * deliberately share one (`currency`, `percent` and `duration` all declare `number`; `date` and `datetime`
 * share `date`; `url`, `email` and `phone` share `text`). Keying on the declared id means a new field type
 * picks an editor by declaring one, and this file never grows a branch.
 *
 * Two answers that are not components, and both are honest:
 *  · **`null`** — the column is read-only (`field.readOnly`, or a descriptor with `editable: false`). The cell
 *    stays a cell and no editor exists to be opened, which is `docs/01` §Editing the underlying note: read-only
 *    properties *render as disabled cells with a tooltip, never as editable inputs that silently discard
 *    input*.
 *  · **the text editor** — an id nobody registered (a `.base` file written by a newer version, a descriptor
 *    added before its editor). Falling back to a plain input is the only failure that does not lose data: the
 *    value can still be read and corrected, and the field's own parser is what turns it back into a value.
 */
import type { ReactElement } from 'react';

import { AttachmentEditor } from './AttachmentEditor';
import { CheckboxEditor } from './CheckboxEditor';
import { DateEditor } from './DateEditor';
import { LongTextEditor } from './LongTextEditor';
import { NumberEditor } from './NumberEditor';
import { RatingEditor } from './RatingEditor';
import { SelectEditor } from './SelectEditor';
import { TextEditor } from './TextEditor';
import type { EditSession } from '../editSession';
import type { ResolvedField } from '../../core/schema/propertySchema';
import type { CellRef } from '../../core/ops/types';

/** What every editor is handed. Props are primitives and stable references — cells are memoised. */
export type EditorProps = {
	readonly field: ResolvedField;
	readonly ref: CellRef;
	/** The column's width, so a popover can size itself to its cell rather than to the viewport. */
	readonly width: number;
	/** The text the cell shows, as the start of the draft. Always a string: the editor edits text. */
	readonly initial: string;
	readonly session: EditSession;
	/**
	 * The element popovers are appended to: the grid **area**, which sits outside the scroller. A popover drawn
	 * inside the scroller would be clipped by it the moment its cell scrolled, and a popover drawn on
	 * `document.body` would outlive the view that owns it. A stable callback, so it costs no re-render.
	 */
	readonly popoverHost: () => HTMLElement | null;
	/** Resolves an attachment path inside the vault. `undefined` in a host that cannot answer. */
	readonly resolveLink?: ((path: string) => boolean) | undefined;
};

/** The editor for a resolved field, or `null` when there is nothing to edit. */
export function editorFor(field: ResolvedField): ((props: EditorProps) => ReactElement) | null {
	if (field.readOnly || !field.descriptor.editable) {
		return null;
	}
	const editor = field.descriptor.editor;
	if (editor === TEXT_EDITOR || editor === undefined) {
		return TextEditor;
	}
	return REGISTRY[editor] ?? TextEditor;
}

/** The declared ids this build knows. Anything else falls back to `TextEditor` (see the header). */
const REGISTRY: Record<string, (props: EditorProps) => ReactElement> = {
	text: TextEditor,
	longText: LongTextEditor,
	number: NumberEditor,
	date: DateEditor,
	checkbox: CheckboxEditor,
	rating: RatingEditor,
	select: SelectEditor,
	multiSelect: SelectEditor,
	attachment: AttachmentEditor,
};

/** `FieldDescriptor.editor` is a plain string; the text editor is the one id the registry does not need. */
const TEXT_EDITOR = 'text';

/** The ids this build registers, for the tests that iterate the registry and for `docs`-level inventory. */
export function registeredEditorIds(): readonly string[] {
	return Object.keys(REGISTRY);
}

/**
 * `readonly` is a real declared editor id (`src/core/schema/propertySchema.ts` marks unmappable properties
 * with it) and it means what `null` means. Keeping the name here — rather than only in the schema — documents
 * the one id a reader might expect to find in `REGISTRY` and not find.
 */
export const READONLY_EDITOR_ID = 'readonly';
