/**
 * `AttachmentEditor` — a path entry with a link to the file when it resolves in the vault.
 *
 * `docs/03` §Field type → frontmatter mapping fixes the value: *`string` path, or `"[[link]]"` when inside the
 * vault, or `string[]`*. Two consequences shape this editor:
 *
 *  · **What the user types is kept.** No path rewriting, no `app://` urls, no normalising — the cell holds the
 *    text, and the descriptor stores it (`docs/03` §Frontmatter write rules, rule 6: no objects in frontmatter).
 *  · **Resolving is a *read*, and it is optional.** Whether a path points at a real file is a vault question, and
 *    the grid may not ask it: `src/grid/**` does not import `obsidian`. So the answer arrives as a callback from
 *    the view (`resolveLink`), and when nobody can answer, the link row is simply absent — the editor still
 *    works, it just cannot promise the file exists. A broken link that *looks* fine is worse than no link.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import { Popover } from './Popover';
import { useEditState } from './useEditState';
import { useEditorKeys } from './useEditorKeys';
import type { EditorProps } from './registry';

export function AttachmentEditor(props: EditorProps): ReactElement {
	const { field, ref, width, session, popoverHost, resolveLink } = props;
	const state = useEditState(session);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		const input = inputRef.current;
		if (input === null) {
			return;
		}
		input.focus();
		input.select();
	}, []);

	const path = state.draft.trim();
	const resolves = useMemo(
		() => (resolveLink === undefined || path === '' ? false : resolveLink(path)),
		[resolveLink, path],
	);

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
		<Popover
			host={popoverHost()}
			ref_={ref}
			width={width}
			label={`${field.definition.name} attachment`}
			onDismiss={() => {
				session.cancel();
			}}
		>
			<div className="cell-pop-stack">
				<input
					ref={inputRef}
					className="cell-editor"
					type="text"
					value={state.draft}
					aria-label={field.definition.name}
					onChange={onChange}
					onKeyDown={onKeyDown}
					onBlur={onBlur}
					{...(state.error === null ? {} : { 'aria-invalid': true })}
				/>
				{resolves ? (
					// A `span`, not an `a`: opening the file is the Obsidian host's business, and the grid may not
					// navigate. It says what it knows — the path resolves — and no more.
					<span className="cell-pop-note">This file is in your vault</span>
				) : null}
				{path !== '' && !resolves && resolveLink !== undefined ? (
					<span className="cell-pop-note is-warning">No file at this path (yet)</span>
				) : null}
			</div>
		</Popover>
	);
}
