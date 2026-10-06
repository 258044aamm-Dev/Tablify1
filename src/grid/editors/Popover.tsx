/**
 * The popover shell the three "choose something" editors share: single-select, multi-select, rating and
 * attachment.
 *
 * Positioned from the cell's own box at the moment it opens, never during a render: `getBoundingClientRect` is
 * a layout read, and the layout contract (`docs/04`) only allows one where nothing is being negotiated. It is
 * appended to the **grid area** — the layer above the scroller — for two reasons that both come from step 17's
 * geometry: a popover inside the scroller is clipped by it the instant its cell scrolls, and a popover on
 * `document.body` would be a second piece of UI the view does not own and cannot unmount.
 *
 * Keyboard: the shell is a `dialog`-ish region with a list inside, and it keeps its own focus. `Escape` is not
 * handled here — the editor that owns the list calls `session.escape()` and acts on the answer, which is how
 * "Escape closes the list before it closes the editor" becomes one line of state-machine behaviour rather than
 * a key-handling convention every editor invents again.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { CellRef } from '../../core/ops/types';

export type PopoverProps = {
	readonly host: HTMLElement | null;
	readonly ref_: CellRef;
	/** The cell's width: the popover is never narrower than the column it belongs to. */
	readonly width: number;
	readonly label: string;
	readonly children: ReactNode;
	/** Called when a click lands outside the popover — a finished gesture, so the editor closes itself. */
	readonly onDismiss: () => void;
};

/** Keeps a popover inside the pane: flipped above the cell when there is more room there. */
const GAP = 4;

export function Popover(props: PopoverProps): ReactElement | null {
	const { host, ref_, width, label, children, onDismiss } = props;
	const panelRef = useRef<HTMLDivElement | null>(null);
	const [style, setStyle] = useState<CSSProperties | null>(null);

	useLayoutEffect(() => {
		const panel = panelRef.current;
		const area = host;
		if (panel === null || area === null) {
			return;
		}
		// The cell this popover belongs to. `data-cell` is the grid's own identity for a cell (step 17), and
		// reading it is cheaper and more truthful than threading a rect down from the row.
		const cell = area.querySelector<HTMLElement>(
			`[data-cell="${ref_.filePath}::${ref_.fieldId}"]`,
		);
		const anchor = cell?.getBoundingClientRect() ?? area.getBoundingClientRect();
		const areaBox = area.getBoundingClientRect();
		const height = panel.getBoundingClientRect().height;
		const below = anchor.bottom - areaBox.top + GAP;
		const above = anchor.top - areaBox.top - height - GAP;
		const flip = below + height > areaBox.height && above > 0;
		// `left`/`top` are relative to the area because the panel is a child of it, in flow order after the
		// lanes — an absolutely positioned element, so no lane geometry moves.
		setStyle({
			left: `${String(Math.max(0, Math.min(anchor.left - areaBox.left, areaBox.width - width)))}px`,
			top: `${String(flip ? above : below)}px`,
			width: `${String(Math.max(width, 180))}px`,
		});
	}, [host, ref_.filePath, ref_.fieldId, width]);

	/** A press that lands outside is a finished gesture. Capture phase, so it beats the cell's own handler. */
	const onPointerDown = useCallback(
		(event: PointerEvent): void => {
			const panel = panelRef.current;
			if (panel === null || !(event.target instanceof Node) || panel.contains(event.target)) {
				return;
			}
			onDismiss();
		},
		[onDismiss],
	);

	useLayoutEffect(() => {
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
		};
	}, [onPointerDown]);

	const role = useMemo(() => ({ role: 'dialog', 'aria-label': label }), [label]);

	if (host === null) {
		return null;
	}
	return createPortal(
		<div
			className="cell-pop"
			ref={panelRef}
			data-popover="cell"
			{...role}
			style={style ?? { visibility: 'hidden', width: `${String(width)}px` }}
		>
			{children}
		</div>,
		host,
	);
}
