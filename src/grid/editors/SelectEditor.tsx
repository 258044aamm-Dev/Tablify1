/**
 * `SelectEditor` — the single-select and multi-select option list.
 *
 * **Why an inline list rather than Obsidian's `SuggestModal`.** The step's prompt allows the modal "where the
 * docs say so"; they do not say so anywhere (`docs/01`, `docs/04`), and two facts decide it against:
 * a modal takes over the keyboard — `Tab`, `Escape` and the arrow keys stop meaning what `docs/01` §Core
 * interaction model says they mean — and this module may not import `obsidian` at all (the architecture rule
 * keeps that import inside `grid/menus/**` and `grid/dialogs/**`). So the list is inline, in the grid's own
 * keyboard vocabulary, and it is searchable and arrow-navigable like the modal would have been.
 *
 * **Writes.** A single select writes on choose, and choosing the current option clears it — the prototype's
 * behaviour, and the only way back to "no value". A multi select writes **once per toggle** with the list
 * staying open (the decision taken for this build): each toggle is its own undo step, which is what a person
 * expects from "I ticked three boxes". Creating an option is an explicit list item — never a blur, never a
 * side effect of typing (`prototype/js/grid.js` — `pop-create`: `+ Create "…"`), and it is offered only when
 * the typed text matches no option exactly.
 *
 * **Escape closes the list before it closes the editor.** The session's `escape()` answers which of the two it
 * did; the component only has to call it. That ordering is what a nested surface has to have, and it is tested
 * as state-machine behaviour rather than as a key-handling convention.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';

import { Popover } from './Popover';
import type { EditorProps } from './registry';
import type { FieldOption } from '../../core/types';

export function SelectEditor(props: EditorProps): ReactElement {
	const { field, ref, width, session, popoverHost } = props;
	const multi = field.descriptor.id === 'multiSelect';
	/**
	 * The options the column carries. `field.options` is the **validated** `FieldOptions` (the resolution's own
	 * output), not the raw `fieldOptions` YAML: entries the schema could not read were already dropped with a
	 * reason, so this list is the one a writer may extend.
	 */
	const options = field.options.options ?? [];

	/** The chosen labels, or the one chosen label. Labels are the values (`docs/03`: the option **label**). */
	const chosen = useMemo<readonly string[]>(
		() => readChosen(session.get().draft, multi),
		[session, multi],
	);
	const [query, setQuery] = useState('');
	const [cursor, setCursor] = useState(0);
	const searchRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		searchRef.current?.focus();
		// The list is the nested layer: `escape()` must close it, not the editor, while it is open.
		session.setListOpen(true);
		return () => {
			session.setListOpen(false);
		};
	}, [session]);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return needle === ''
			? options
			: options.filter((option) => option.name.toLowerCase().includes(needle));
	}, [options, query]);

	/** The `+ Create "…"` row is offered only when nothing matches exactly. */
	const exact = options.some(
		(option) => option.name.toLowerCase() === query.trim().toLowerCase(),
	);
	const canCreate = field.descriptor.id === 'singleSelect' || multi;
	const showCreate = canCreate && query.trim() !== '' && !exact;
	const rows = showCreate ? filtered.length + 1 : filtered.length;

	const choose = useCallback(
		(option: FieldOption): void => {
			if (!multi) {
				session.commit(option.name === chosen[0] ? null : option.name);
				return;
			}
			const next = chosen.includes(option.name)
				? chosen.filter((label) => label !== option.name)
				: [...chosen, option.name];
			session.commit(next);
		},
		[session, multi, chosen],
	);

	/**
	 * Creating is explicit: the row exists, the user presses it. The new option is written to the view's own
	 * options through the same cell write path (`docs/03` §`fieldOptions` shape) — the store's command is the
	 * only writer, so a created label is one undo step like any other edit.
	 */
	const create = useCallback((): void => {
		const label = query.trim();
		if (label === '') {
			return;
		}
		session.commit(multi ? [...chosen, label] : label);
	}, [session, query, multi, chosen]);

	const onKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLElement>): void => {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				const step = event.key === 'ArrowDown' ? 1 : -1;
				if (rows > 0) {
					setCursor((at) => (at + step + rows) % rows);
				}
				return;
			}
			if (event.key === 'Tab') {
				// Tab leaves the list the way Enter does for a single select; a multi select keeps the list open
				// (each toggle is its own write, so there is nothing pending to commit).
				event.preventDefault();
				event.stopPropagation();
				if (!multi) {
					session.commit();
				}
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				event.stopPropagation();
				if (cursor === filtered.length && showCreate) {
					create();
					return;
				}
				const option = filtered[cursor];
				if (option !== undefined) {
					choose(option);
				}
				return;
			}
			if (event.key === 'Escape') {
				// One Escape: the list closes (session.escape() answers `closedList` the first time and
				// `cancelled` the second). The event is stopped so the grid's own Escape never sees the first one.
				event.stopPropagation();
				session.escape();
			}
		},
		[session, cursor, filtered, showCreate, rows, create, choose],
	);

	return (
		<Popover
			host={popoverHost()}
			ref_={ref}
			width={width}
			label={`${field.definition.name} options`}
			onDismiss={() => {
				session.cancel();
			}}
		>
			<div className="cell-pop-list" onKeyDown={onKeyDown}>
				<input
					ref={searchRef}
					className="cell-pop-search"
					type="search"
					value={query}
					placeholder="Search or create…"
					aria-label={`Search ${field.definition.name}`}
					onChange={(event) => {
						setQuery(event.target.value);
						setCursor(0);
					}}
				/>
				<div className="cell-pop-items" role="listbox" aria-multiselectable={multi}>
					{filtered.map((option, index) => {
						const picked = chosen.includes(option.name);
						return (
							<button
								key={option.id}
								type="button"
								role="option"
								aria-selected={picked}
								className={`cell-pop-item${index === cursor ? ' is-cursor' : ''}${picked ? ' is-picked' : ''}`}
								onMouseEnter={() => {
									setCursor(index);
								}}
								onClick={() => {
									choose(option);
								}}
							>
								<span
									className={`pill${option.color === undefined ? '' : ` pill--${option.color}`}`}
								>
									{option.name}
								</span>
								{picked ? <span className="cell-pop-tick">✓</span> : null}
							</button>
						);
					})}
					{showCreate ? (
						<button
							type="button"
							className={`cell-pop-item cell-pop-create${cursor === filtered.length ? ' is-cursor' : ''}`}
							onClick={create}
						>
							+ Create “{query.trim()}”
						</button>
					) : null}
					{rows === 0 ? <div className="cell-pop-empty">No options yet</div> : null}
				</div>
			</div>
		</Popover>
	);
}

/**
 * What the cell currently holds, as labels. `draft` is the *display* text (a select shows its labels joined);
 * the store's own canonical value is not needed to choose — comparing labels is enough, and it is what the
 * prototype did (`row.cells[field.id].indexOf(o.id)` against names).
 */
function readChosen(draft: string, multi: boolean): readonly string[] {
	if (draft === '') {
		return [];
	}
	if (!multi) {
		return [draft];
	}
	return draft
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part !== '');
}
