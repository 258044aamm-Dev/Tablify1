/**
 * `TextEditor` — the editor for `text`, `url`, `email` and `phone` (four types, one editor, and the descriptor
 * is what says so), and the fallback for any editor id this build does not know.
 *
 * One input, one commit per finished edit: `Enter` and `Tab` commit, blur commits, `Escape` cancels. Enter and
 * Tab are **not** handled here — they belong to the cell's keyboard layer (step 19), where "commit *and* move
 * down / right" lives. The editor's job is to hold the draft and report it.
 *
 * An empty draft means **no value** (`docs/03` §Frontmatter write rules, rule 3: clearing deletes the key), so
 * erasing a URL deletes the property instead of writing `""`.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import { useEditState } from './useEditState';
import { useEditorKeys } from './useEditorKeys';
import type { EditorProps } from './registry';

export function TextEditor(props: EditorProps): ReactElement {
	const { session, field } = props;
	const state = useEditState(session);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		const input = inputRef.current;
		if (input === null) {
			return;
		}
		// Focus and select on open: a cell edit replaces its content by default, which is what a spreadsheet
		// user expects and what `docs/01` §Core interaction model says typing on an unfocused cell does.
		input.focus();
		input.select();
	}, []);

	/**
	 * Blur commits, unless the session has already finished. Two things race on the commit path: React unmounts
	 * the input, the browser fires `blur`, and the session would be asked to write a draft into a cell nobody is
	 * editing. The guard is the session's own status, not a timer — the prototype used a 60 ms timestamp
	 * (`prototype/js/grid.js`, `editing.at`), which is exactly the kind of magic number the audit flagged.
	 */
	const onBlur = useCallback((): void => {
		if (session.get().status === 'editing') {
			session.commit();
		}
	}, [session]);

	const onChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>): void => {
			session.update(event.target.value);
		},
		[session],
	);

	const onKeyDown = useEditorKeys(session, () => {
		session.commit();
	});

	return (
		<input
			ref={inputRef}
			className="cell-editor"
			type="text"
			value={state.draft}
			onChange={onChange}
			onKeyDown={onKeyDown}
			onBlur={onBlur}
			aria-label={field.definition.name}
			{...(state.error === null ? {} : { 'aria-invalid': true })}
		/>
	);
}
