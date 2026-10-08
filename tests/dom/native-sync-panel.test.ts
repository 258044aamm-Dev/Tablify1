/**
 * The native sync panel, driven in a real jsdom element through its own buttons and fields.
 *
 * What is proved: each button calls exactly the sync direction it names; the values a person typed are passed on,
 * trimmed; a second action cannot start while one runs; a run that needs a review is handed to `onReview` and a refused
 * run is not; a missing field is refused before any link is made; the excluded fields and their reasons are listed.
 * What is not proved here: the Obsidian `Modal` that mounts the panel, and the real remote calls. Those are NOT RUN on a
 * device.
 */
import { describe, expect, it, vi } from 'vitest';

import { NativeSyncPanel } from '../../src/plugin/sync/NativeSyncPanel';
import type {
	NativePanelOutcome,
	NativeSyncPanelOptions,
} from '../../src/plugin/sync/NativeSyncPanel';
import type { NativeSyncStatus } from '../../src/plugin/sync/nativeHost';
import { augment } from './support/dom';

const LINKED: NativeSyncStatus = {
	tableId: 'tbl1',
	tableName: 'Orders',
	linked: true,
	problem: null,
	remoteTableName: 'Orders (remote)',
	lastPulledAt: '2026-10-07T10:00:00.000Z',
	lastPushedAt: null,
	synced: ['Name', 'Qty'],
	excluded: [{ name: 'Total', reason: 'This field is a formula and is read only.' }],
	hasToken: true,
};

const UNLINKED: NativeSyncStatus = {
	...LINKED,
	linked: false,
	remoteTableName: null,
	lastPulledAt: null,
	excluded: [],
};

const RAN: NativePanelOutcome = { message: 'Pulled 2 rows.', needsReview: false };

type Options = NativeSyncPanelOptions<NativePanelOutcome>;

function flush(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function mount(overrides: Partial<Options> = {}, status: NativeSyncStatus | null = LINKED) {
	const root = augment(document.createElement('div'));
	const options: Options = {
		status: vi.fn(async () => status),
		sync: vi.fn(async () => RAN),
		link: vi.fn(async () => 'Linked.'),
		onReview: vi.fn(),
		announce: vi.fn(),
		...overrides,
	};
	const panel = new NativeSyncPanel<NativePanelOutcome>(root, options);
	return { root, options, panel };
}

function input(root: HTMLElement, index: number): HTMLInputElement {
	const found = root.querySelectorAll<HTMLInputElement>('input').item(index);
	if (!found) {
		throw new Error(`no input ${String(index)}`);
	}
	return found;
}

function button(root: HTMLElement, label: string): HTMLButtonElement {
	const found = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label);
	if (found === undefined) {
		throw new Error(`no button "${label}"`);
	}
	return found;
}

function statusLine(root: HTMLElement): string | null | undefined {
	return root.querySelector('[role="status"]')?.textContent;
}

describe('native sync panel: linked table', () => {
	it('shows the remote table, the last pull, the synced fields and the excluded reasons', async () => {
		const { root } = mount();
		await flush();
		const text = root.textContent ?? '';
		expect(text).toContain('Orders (remote)');
		expect(text).toContain('2026-10-07T10:00:00.000Z');
		expect(text).toContain('Last pushed: never');
		expect(text).toContain('Fields that sync: Name, Qty.');
		expect(text).toContain('Total: This field is a formula and is read only.');
	});

	it('Pull, Push and Pull and push each call sync with their own direction', async () => {
		const { root, options } = mount();
		await flush();
		button(root, 'Pull').click();
		await flush();
		button(root, 'Push').click();
		await flush();
		button(root, 'Pull and push').click();
		await flush();
		expect(options.sync).toHaveBeenNthCalledWith(1, 'pull');
		expect(options.sync).toHaveBeenNthCalledWith(2, 'push');
		expect(options.sync).toHaveBeenNthCalledWith(3, 'both');
	});

	it('shows the run sentence in the status line and announces it', async () => {
		const { root, options } = mount();
		await flush();
		button(root, 'Pull').click();
		await flush();
		expect(statusLine(root)).toBe('Pulled 2 rows.');
		expect(options.announce).toHaveBeenCalledWith('Pulled 2 rows.');
	});

	it('hands a run that needs review to onReview', async () => {
		const review: NativePanelOutcome = {
			message: 'Two fields changed on both sides.',
			needsReview: true,
		};
		const { root, options } = mount({ sync: vi.fn(async () => review) });
		await flush();
		button(root, 'Pull and push').click();
		await flush();
		expect(options.onReview).toHaveBeenCalledWith(review);
	});

	it('does not open a review for a run that does not need one', async () => {
		const { root, options } = mount({ sync: vi.fn(async () => RAN) });
		await flush();
		button(root, 'Pull').click();
		await flush();
		expect(options.onReview).not.toHaveBeenCalled();
	});

	it('a second click while a run is still going does not start another run', async () => {
		let release: (value: NativePanelOutcome) => void = () => undefined;
		const pending = new Promise<NativePanelOutcome>((resolve) => {
			release = resolve;
		});
		const { root, options, panel } = mount({ sync: vi.fn(() => pending) });
		await flush();
		button(root, 'Pull').click();
		button(root, 'Push').click();
		await flush();
		expect(options.sync).toHaveBeenCalledTimes(1);
		expect(button(root, 'Pull').disabled).toBe(true);
		release(RAN);
		await flush();
		await flush();
		expect(panel.isBusy()).toBe(false);
		expect(button(root, 'Pull').disabled).toBe(false);
	});

	it('keeps the outcome of a run on screen after the refresh that follows it', async () => {
		const { root } = mount({ sync: vi.fn(async () => ({ message: 'Pushed 1 row.' })) });
		await flush();
		button(root, 'Push').click();
		await flush();
		await flush();
		expect(statusLine(root)).toBe('Pushed 1 row.');
	});

	it('warns when the token is missing and keeps the buttons', async () => {
		const { root } = mount({}, { ...LINKED, hasToken: false });
		await flush();
		expect(root.textContent).toContain('Add the access token in the plugin settings first.');
		expect(button(root, 'Pull')).toBeDefined();
	});
});

describe('native sync panel: unlinked table', () => {
	it('shows the link form and no sync buttons', async () => {
		const { root } = mount({}, UNLINKED);
		await flush();
		expect(root.textContent).toContain('This table is not linked to a remote table yet.');
		expect(() => button(root, 'Pull')).toThrow();
		expect(button(root, 'Link table')).toBeDefined();
	});

	it('links with the trimmed values the person typed', async () => {
		const { root, options } = mount({}, UNLINKED);
		await flush();
		input(root, 0).value = '  app123  ';
		input(root, 1).value = 'tbl456';
		input(root, 2).value = ' Name ';
		button(root, 'Link table').click();
		await flush();
		expect(options.link).toHaveBeenCalledWith({
			baseId: 'app123',
			tableId: 'tbl456',
			keyFieldName: 'Name',
		});
		expect(statusLine(root)).toBe('Linked.');
	});

	it('refuses a link with a missing field before any link is made', async () => {
		const { root, options } = mount({}, UNLINKED);
		await flush();
		input(root, 0).value = 'app123';
		input(root, 1).value = '';
		input(root, 2).value = 'Name';
		button(root, 'Link table').click();
		await flush();
		expect(options.link).not.toHaveBeenCalled();
		expect(statusLine(root)).toBe(
			'Enter the base identifier, the table identifier and the key field name.',
		);
	});
});

describe('native sync panel: no table', () => {
	it('says to select a table when there is no active table', async () => {
		const { root } = mount({}, null);
		await flush();
		expect(root.textContent).toContain('Select a table first.');
	});
});
