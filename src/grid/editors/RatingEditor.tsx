/**
 * `RatingEditor` — a row of stars, click to set, click the same star to clear.
 *
 * **Arrow keys are deliberately not an editor control.** The first draft of the step asked for them; that
 * conflicts with `docs/01` §Core interaction model, where arrows *move the active cell* (and extend the range
 * with Shift), and a control that swallowed them would break the grid's primary keyboard path in a cell nobody
 * meant to edit. The decision taken for this build is therefore the prototype's: **click sets a rating**, and
 * arrows keep doing what the grid says they do. The star row is `role="radiogroup"` with real radio buttons, so
 * the OS screen reader and the Tab/Space path give keyboard users a way in without inventing a second key
 * vocabulary.
 *
 * The write is the prototype's: one value per click, immediately, with the editor finishing on the spot
 * (`prototype/js/grid.js` — `openPopover`, rating branch: `store.setCell(row.id, field.id, n); closePopovers()`).
 * Clicking the star that is already set clears the rating, which is the only way back to "no value".
 */
import { useCallback } from 'react';
import type { ReactElement } from 'react';

import { Popover } from './Popover';
import type { EditorProps } from './registry';

/** `max` lives in `fieldOptions` (`docs/03` §Field type → frontmatter mapping: *`max` in `fieldOptions`*). */
const DEFAULT_MAX = 5;

export function RatingEditor(props: EditorProps): ReactElement {
	const { field, ref, width, session, popoverHost } = props;
	const maxOption = field.options.max;
	const max =
		maxOption !== undefined && Number.isFinite(maxOption) && maxOption > 0
			? Math.floor(maxOption)
			: DEFAULT_MAX;

	const parsed = field.descriptor.parse(session.get().draft, field.context);
	const current = parsed.ok && typeof parsed.value === 'number' ? parsed.value : 0;

	const set = useCallback(
		(star: number): void => {
			// Clicking the current value clears it: `null` is "no rating", and it is the only path back to it.
			session.commit(star === current ? null : star);
		},
		[session, current],
	);

	return (
		<Popover
			host={popoverHost()}
			ref_={ref}
			width={width}
			label={`${field.definition.name} rating`}
			onDismiss={() => {
				// A press outside is "done": the value is already written, so there is nothing to commit.
				session.cancel();
			}}
		>
			<div className="cell-pop-row" role="radiogroup" aria-label={field.definition.name}>
				{Array.from({ length: max }, (_unused, index) => {
					const star = index + 1;
					const on = star <= current;
					return (
						<button
							key={star}
							type="button"
							role="radio"
							aria-checked={star === current}
							aria-label={`${String(star)} of ${String(max)}`}
							className={`star-btn${on ? ' is-on' : ''}`}
							onClick={() => {
								set(star);
							}}
						>
							<span aria-hidden="true">★</span>
						</button>
					);
				})}
				<button
					type="button"
					className="cell-pop-action"
					onClick={() => {
						session.commit(null);
					}}
				>
					Clear
				</button>
			</div>
		</Popover>
	);
}
