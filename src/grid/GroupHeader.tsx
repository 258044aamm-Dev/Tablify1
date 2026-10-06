/**
 * A group header, as a **lane item**: exactly one row tall, sitting in the flow of the lane where its group
 * begins.
 *
 * That is the whole design, and it is what keeps grouping free: the windowing arithmetic from step 16 is
 * uniform-height arithmetic, so making a header one item of exactly `rowHeight` means the same maths windows
 * groups and rows together — no second mapping between scroll offset and item index, no second place for the
 * arithmetic to be wrong. The prototype reached the same conclusion (`.group-bar { height: var(--row-h) }`).
 *
 * It is `memo`ed for the same reason a row is: a scroll must not re-render the items that are still mounted.
 */
import { memo } from 'react';
import type { ReactElement } from 'react';

export type GroupHeaderProps = {
	readonly groupKey: string;
	readonly label: string;
	readonly count: number;
	readonly collapsed: boolean;
	readonly onToggle: (key: string) => void;
};

function GroupHeaderView(props: GroupHeaderProps): ReactElement {
	const { groupKey, label, count, collapsed, onToggle } = props;
	return (
		<div
			className="grid-group"
			data-group={groupKey}
			// Not a row: a screen reader should hear the group, not a row it is not in. `aria-expanded` is the
			// honest role here — the header is a disclosure control for the rows under it.
			role="row"
			aria-expanded={!collapsed}
		>
			<button
				className="grid-group-toggle"
				type="button"
				onClick={() => {
					onToggle(groupKey);
				}}
				aria-label={`${collapsed ? 'Expand' : 'Collapse'} group ${label}`}
			>
				<span className="grid-group-chevron" aria-hidden="true">
					{collapsed ? '▸' : '▾'}
				</span>
			</button>
			<span className="grid-group-label">{label}</span>
			<span className="grid-group-count">{count}</span>
		</div>
	);
}

export const GroupHeader = memo(GroupHeaderView);
