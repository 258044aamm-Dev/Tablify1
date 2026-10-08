/**
 * The native import wizard, driven in a real jsdom element through the panel's own controls.
 *
 * What is proved here, and why it is the shipped path: the panel is the class the Obsidian `Modal` mounts, and every
 * click below is a real `click()` on the button a person sees. The apply runs `applyDatabaseImportPlan` against a real
 * store and session (the same rig the runner test uses), so "the import was written" means a document the store
 * holds, not a fixture that agrees with itself. Cancel is pressed before the commit point and must leave the document
 * untouched. What is not proved here is the Obsidian host itself: `Modal`, `Notice`, and the toolbar button are checked
 * only by typecheck and the layout suite, and a physical-device pass is still NOT RUN.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import { createWriteQueue } from '../../src/adapters/tablifyFile/queue';
import { openDatabase } from '../../src/adapters/tablifyFile/session';
import type { DatabaseStore } from '../../src/adapters/tablifyFile/databaseStore';
import type { DatabaseSession } from '../../src/adapters/tablifyFile/session';
import { serializeDocument } from '../../src/core/database';
import type { DatabaseDocument } from '../../src/core/database';
import { ID_PREFIXES } from '../../src/core/database/ids';
import type { IdKind } from '../../src/core/database/ids';
import { NativeImportPanel } from '../../src/plugin/nativeImport/NativeImportPanel';
import type { ImportPlanEnvironment } from '../../src/plugin/nativeImport/model';
import { createFakeClock } from '../fakes/clock';
import { createFakePort } from '../fakes/tablifyFile';
import { augment } from './support/dom';

const PATH = 'Databases/Native-import-panel.tablify';
const TEXT = 'Name\tQty\nAda\t2\nGrace\t3\n';

function emptyDocument(): DatabaseDocument {
	return {
		format: 'tablify',
		version: 1,
		databaseId: `db_${'p'.repeat(26)}`,
		name: 'Panel test',
		tables: [],
		unknown: [],
	};
}

function environment(): ImportPlanEnvironment {
	const counts = new Map<IdKind, number>();
	return {
		createId: (kind) => {
			const next = (counts.get(kind) ?? 0) + 1;
			counts.set(kind, next);
			return `${ID_PREFIXES[kind]}_panel${String(next)}`;
		},
		now: () => Date.parse('2026-10-08T10:20:30.000Z'),
		timezone: 'UTC',
		locale: 'en-GB',
	};
}

interface Rig {
	readonly session: DatabaseSession;
	readonly store: DatabaseStore;
	close(): Promise<void>;
}

async function rig(): Promise<Rig> {
	const port = createFakePort({ [PATH]: serializeDocument(emptyDocument()) });
	const opened = await openDatabase(port, PATH);
	if (!opened.ok) {
		throw new Error('the panel fixture must open');
	}
	const clock = createFakeClock();
	const queue = createWriteQueue(opened.session, { scheduler: clock, debounceMs: 400 });
	const store = createDatabaseStore({ session: opened.session, queue });
	return {
		session: opened.session,
		store,
		async close(): Promise<void> {
			store.dispose();
			await queue.close({ flush: false });
		},
	};
}

const mounted: HTMLElement[] = [];

function mount(store: DatabaseStore): {
	readonly root: HTMLElement;
	readonly panel: NativeImportPanel;
	readonly announced: string[];
} {
	const root = augment(document.createElement('div'));
	document.body.append(root);
	mounted.push(root);
	const announced: string[] = [];
	const panel = new NativeImportPanel(root, {
		store,
		environment: environment(),
		sourceName: 'pasted table',
		close: () => undefined,
		announce: (message) => {
			announced.push(message);
		},
	});
	return { root, panel, announced };
}

function buttonNamed(root: HTMLElement, label: string): HTMLButtonElement {
	const found = Array.from(root.querySelectorAll('button')).find(
		(button) => button.textContent === label,
	);
	if (found === undefined) {
		throw new Error(`no button named ${label}`);
	}
	return found;
}

function setText(root: HTMLElement, text: string): void {
	const area = root.querySelector('textarea');
	if (area === null) {
		throw new Error('the source step must show a textarea');
	}
	area.value = text;
	area.dispatchEvent(new Event('change'));
}

function setNewTableName(root: HTMLElement, name: string): void {
	const input = root.querySelector<HTMLInputElement>('.tablify-native-import-name');
	if (input === null) {
		throw new Error('the create step must show the name input');
	}
	input.value = name;
	input.dispatchEvent(new Event('change'));
}

afterEach(() => {
	for (const root of mounted.splice(0)) {
		root.remove();
	}
});

describe('native import panel', () => {
	it('keeps Next disabled until the source reads, and says why nothing is previewed yet', async () => {
		const fixture = await rig();
		const { root } = mount(fixture.store);

		expect(buttonNamed(root, 'Next').disabled).toBe(true);
		expect(root.textContent).toContain('Nothing to preview yet.');
		await fixture.close();
	});

	it('imports the reviewed plan as one undoable change, saved once, and reports it in one sentence', async () => {
		const fixture = await rig();
		const { root, panel, announced } = mount(fixture.store);

		setText(root, TEXT);
		buttonNamed(root, 'Next').click();
		setNewTableName(root, 'People');
		buttonNamed(root, 'Review').click();
		expect(panel.currentStep()).toBe('review');
		expect(buttonNamed(root, 'Apply import').disabled).toBe(false);

		buttonNamed(root, 'Apply import').click();
		await vi.waitFor(() => {
			expect(panel.currentStep()).toBe('done');
		});

		const result = panel.lastResult();
		expect(result).toMatchObject({ kind: 'saved', appliedRecords: 2 });
		expect(fixture.session.getDocument().tables.map((table) => table.name)).toEqual(['People']);
		expect(fixture.store.getSnapshot().history).toMatchObject({
			depth: 1,
			undoLabel: 'Import pasted table',
		});
		expect(announced).toEqual([
			'Imported 2 record(s). It is one undo step, and the file is saved.',
		]);
		expect(root.textContent).toContain('Imported 2 record(s).');
		await fixture.close();
	});

	it('cancel before the commit point leaves the document and history exactly as they were', async () => {
		const fixture = await rig();
		const before = serializeDocument(fixture.session.getDocument());
		const { root, panel, announced } = mount(fixture.store);

		setText(root, TEXT);
		buttonNamed(root, 'Next').click();
		setNewTableName(root, 'People');
		buttonNamed(root, 'Review').click();
		buttonNamed(root, 'Apply import').click();
		buttonNamed(root, 'Cancel import').click();

		await vi.waitFor(() => {
			expect(panel.currentStep()).toBe('done');
		});
		expect(panel.lastResult()).toMatchObject({ kind: 'cancelled' });
		expect(serializeDocument(fixture.session.getDocument())).toBe(before);
		expect(fixture.store.getSnapshot().history.canUndo).toBe(false);
		expect(announced).toEqual(['Import cancelled. Nothing was changed.']);
		await fixture.close();
	});
});
