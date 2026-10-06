/**
 * `NumberEditor` — one editor for `number`, `currency`, `percent` and `duration`, because that is what those
 * four descriptors declare (`FieldDescriptor.editor === 'number'`). The **type** decides the presentation, and
 * the field's own parser decides what the text means: this component never converts anything itself.
 *
 * That division is what makes the paste cases work without special-casing them here:
 *
 * | typed | column | canonical value | who decides |
 * |---|---|---|---|
 * | `1,200` | number | `1200` | `parseDecimalLocalized` (vault locale) |
 * | `25%` | percent | `25` | the percent descriptor (`docs/03`: *25 means 25%*) |
 * | `45m` | duration | `2700` seconds | the duration descriptor's explicit-units rule |
 * | `1:30` | duration | `5400` seconds | clock-style is always `h:mm(:ss)` (the prototype's rule, kept) |
 * | `12 apples` | number | **nothing** — refused | the descriptor answers `parseFailed`, and a value the grid cannot mean is never written |
 *
 * The last row is the important one: a number cell that silently becomes `12` is the bug class
 * `prototype/AUDIT-REPORT.md` records (a parse that guessed instead of refusing). The refusal is shown inline
 * and the editor stays open.
 *
 * Affixes (`$`, `%`, `h:mm:ss`) are decoration around the input, never part of its value: the draft is the
 * text a person typed, and the parser is what understands it.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import { useEditState } from './useEditState';
import { useEditorKeys } from './useEditorKeys';
import type { EditorProps } from './registry';

export function NumberEditor(props: EditorProps): ReactElement {
	const { session, field } = props;
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

	const type = field.descriptor.id;
	const prefix = type === 'currency' ? currencySymbol(field.options.symbol) : '';
	const suffix = type === 'percent' ? '%' : type === 'duration' ? 'h:mm:ss' : '';

	return (
		<span className="cell-editor-wrap">
			{prefix === '' ? null : <span className="cell-editor-affix">{prefix}</span>}
			<input
				ref={inputRef}
				className="cell-editor is-number"
				// `inputMode` rather than `type="number"`: a number input discards what it cannot parse, which is
				// precisely the refusal this editor has to be able to show.
				inputMode="decimal"
				type="text"
				value={state.draft}
				onChange={onChange}
				onKeyDown={onKeyDown}
				onBlur={onBlur}
				aria-label={field.definition.name}
				{...(state.error === null ? {} : { 'aria-invalid': true })}
			/>
			{suffix === '' ? null : <span className="cell-editor-affix">{suffix}</span>}
			{state.error === null ? null : <span className="cell-editor-error">{state.error}</span>}
		</span>
	);
}

/** A currency column's symbol: the field options when they carry one, `$` otherwise (the prototype's default). */
function currencySymbol(symbol: string | undefined): string {
	return symbol === undefined || symbol === '' ? '$' : symbol;
}
