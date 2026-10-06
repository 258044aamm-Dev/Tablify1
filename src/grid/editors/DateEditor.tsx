/**
 * `DateEditor` — one editor for `date` and `datetime` (both declare `editor: 'date'`); the type picks which
 * native input is used.
 *
 * **Write timing: `change` *and* Enter/blur.** That is the decision taken for this build, and it is the one the
 * docs do not settle on their own — `docs/01` §Core interaction model says *Enter — edit the cell; committing
 * moves down one row* and nothing at all about a date picker, so the rule comes from the gesture: choosing a
 * day in a native picker is a finished action, and making the user then press Enter would be asking them to
 * confirm a choice they already made. Typing a date commits on Enter/Tab/blur like any other input.
 *
 * The value that leaves here is whatever the descriptor's parser accepts; the *input* is a local `YYYY-MM-DD`
 * (or `YYYY-MM-DDTHH:mm`) string, because that is the only format a native date input speaks. `datetime` keeps
 * the offset rule from `docs/03` (§Field type → frontmatter mapping: *include the UTC offset when a time is
 * present*) by handing the descriptor the local input text, not a `Date`.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import { useEditState } from './useEditState';
import { useEditorKeys } from './useEditorKeys';
import type { EditorProps } from './registry';

export function DateEditor(props: EditorProps): ReactElement {
	const { session, field } = props;
	const state = useEditState(session);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		const input = inputRef.current;
		if (input === null) {
			return;
		}
		input.focus();
		// No `select()`: a date input's text is not a draft to overwrite, it is a segmented control whose first
		// segment is already the caret.
	}, []);

	const onBlur = useCallback((): void => {
		if (session.get().status === 'editing') {
			session.commit();
		}
	}, [session]);

	/** A pick in the native control is a finished gesture — see the header. */
	const onChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>): void => {
			session.update(event.target.value);
			session.commit();
		},
		[session],
	);

	const onKeyDown = useEditorKeys(session, () => {
		session.commit();
	});

	const withTime = field.descriptor.id === 'datetime';

	return (
		<input
			ref={inputRef}
			className="cell-editor is-date"
			type={withTime ? 'datetime-local' : 'date'}
			value={state.draft}
			onChange={onChange}
			onKeyDown={onKeyDown}
			onBlur={onBlur}
			aria-label={field.definition.name}
			{...(state.error === null ? {} : { 'aria-invalid': true })}
		/>
	);
}
