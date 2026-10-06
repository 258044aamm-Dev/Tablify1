/**
 * `LongTextEditor` — a multi-line value, in a popover with a Save button.
 *
 * The step's first draft specified an inline textarea (Enter = newline, ⌘/Ctrl+Enter commits). That was
 * **overruled for long text**, and the reason is worth keeping: a multi-line editor that is 40 px tall can show
 * one line of a paragraph, and a grid row may not grow to fit one (the layout contract: the row height belongs
 * to the density, and every lane's arithmetic assumes it). The prototype's answer — a popover
 * (`prototype/js/grid.js`, `openPopover`, longText branch: a textarea and an explicit **Save**) — is the one
 * that shows the value, so it is the one this build ships. The divergence is recorded in `PROGRESS.md`.
 *
 * Enter therefore inserts a newline and **Save is the commit**: a gesture the user can see, in a control that
 * cannot be mistaken for a one-line input. `Escape` closes without saving, and so does a press outside — which
 * is what "the draft was abandoned" means for a value nobody wrote yet.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import { Popover } from './Popover';
import { useEditState } from './useEditState';
import type { EditorProps } from './registry';

export function LongTextEditor(props: EditorProps): ReactElement {
	const { field, ref, width, session, popoverHost } = props;
	const state = useEditState(session);
	const areaRef = useRef<HTMLTextAreaElement | null>(null);

	useEffect(() => {
		const area = areaRef.current;
		if (area === null) {
			return;
		}
		area.focus();
		area.select();
	}, []);

	const onChange = useCallback(
		(event: ChangeEvent<HTMLTextAreaElement>): void => {
			session.update(event.target.value);
		},
		[session],
	);

	/** The one commit path: the Save button. Nothing writes on blur or on Escape. */
	const save = useCallback((): void => {
		session.commit();
	}, [session]);

	return (
		<Popover
			host={popoverHost()}
			ref_={ref}
			width={width}
			label={`${field.definition.name} text`}
			onDismiss={() => {
				session.cancel();
			}}
		>
			<div className="cell-pop-stack">
				<textarea
					ref={areaRef}
					className="cell-pop-textarea"
					value={state.draft}
					rows={6}
					aria-label={field.definition.name}
					onChange={onChange}
					{...(state.error === null ? {} : { 'aria-invalid': true })}
				/>
				<div className="cell-pop-row">
					<button type="button" className="tablify-btn is-primary" onClick={save}>
						Save
					</button>
					<button
						type="button"
						className="tablify-btn"
						onClick={() => {
							session.cancel();
						}}
					>
						Cancel
					</button>
				</div>
			</div>
		</Popover>
	);
}
