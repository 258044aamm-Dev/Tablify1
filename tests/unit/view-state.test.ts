/**
 * View state and where it lives — R2 step 7's gate.
 *
 * Two halves. The first is the policy: every piece of view state is classified (document, plugin
 * settings, workspace leaf), the classification is exhaustive by type, and the homes are consistent.
 * The second is the negative half, and it is the one a reviewer cannot check by reading a diff
 * quickly: the native path — the file view, its state module, and every file in
 * `src/adapters/tablifyFile/**` — never mentions a `.base` file, a Bases view, `processFrontMatter`,
 * or a note-row source, because the native file view must not read or touch any of them.
 *
 * The scan reads source **text**, deliberately: an import graph would not catch a string built at
 * runtime, and the promise here is about the whole file, comments included.
 */
import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
	DOCUMENT_VIEW_STATE,
	EMPTY_LEAF_STATE,
	leafStateOf,
	readLeafState,
	SETTINGS_VIEW_STATE,
	WORKSPACE_VIEW_STATE,
} from '../../src/plugin/viewState';
import type { ViewStateEntry, ViewStateHome } from '../../src/plugin/viewState';
import { VIEW_DENSITIES } from '../../src/core/database/index';
import type { RowHeightId } from '../../src/plugin/settings/schema';

const ROOT = new URL('../../', import.meta.url);

function homeOf(entries: Record<string, ViewStateEntry>): readonly ViewStateHome[] {
	return Object.values(entries).map((entry) => entry.home);
}

function everyEntry(
	entries: Record<string, ViewStateEntry>,
): readonly (readonly [string, ViewStateEntry])[] {
	return Object.entries(entries);
}

describe('every piece of view state has exactly one home', () => {
	it('classifies each document key as document state, with a reason', () => {
		for (const [key, entry] of everyEntry(DOCUMENT_VIEW_STATE)) {
			expect(entry.home, key).toBe('document');
			expect(entry.why.length, key).toBeGreaterThan(20);
		}
	});

	it('classifies each global appearance default as settings, with a reason', () => {
		for (const [key, entry] of everyEntry(SETTINGS_VIEW_STATE)) {
			expect(entry.home, key).toBe('settings');
			expect(entry.why.length, key).toBeGreaterThan(20);
		}
	});

	it('classifies each workspace key as workspace state, with a reason', () => {
		for (const [key, entry] of everyEntry(WORKSPACE_VIEW_STATE)) {
			expect(entry.home, key).toBe('workspace');
			expect(entry.why.length, key).toBeGreaterThan(20);
		}
	});

	it('names the density the document stores and the one the settings default to with the same three words', () => {
		// The annotation is the real check: `ViewDensity` is core's union and `RowHeightId` is the
		// settings' union, and if either gains or loses a word this line stops compiling. The assertion
		// below pins the words themselves.
		const agreement: readonly RowHeightId[] = VIEW_DENSITIES;
		expect(agreement).toEqual(['short', 'medium', 'tall']);
	});

	it('keeps the three homes disjoint: no key is classified twice', () => {
		const documentKeys = new Set(Object.keys(DOCUMENT_VIEW_STATE));
		const settingsKeys = new Set(Object.keys(SETTINGS_VIEW_STATE));
		const workspaceKeys = new Set(Object.keys(WORKSPACE_VIEW_STATE));
		for (const key of documentKeys) {
			expect(settingsKeys.has(key)).toBe(false);
			expect(workspaceKeys.has(key)).toBe(false);
		}
		for (const key of settingsKeys) {
			expect(workspaceKeys.has(key)).toBe(false);
		}
		expect(homeOf(DOCUMENT_VIEW_STATE)).not.toContain('settings');
	});

	it('states the one rule the split exists for: a per-view density beats the default', () => {
		expect(DOCUMENT_VIEW_STATE.density.why).toContain('this view');
		expect(SETTINGS_VIEW_STATE.defaultRowHeight.why).toContain('new view');
	});
});

describe('the leaf state a pane writes and reads', () => {
	it('round-trips a selection', () => {
		const selection = { tableId: 'tbl_' + 'a'.repeat(26), viewId: 'viw_' + 'b'.repeat(26) };
		expect(readLeafState(leafStateOf(selection))).toEqual(selection);
	});

	it('reads anything unreadable as nothing selected, rather than refusing to open', () => {
		expect(readLeafState(null)).toEqual(EMPTY_LEAF_STATE);
		expect(readLeafState('not an object')).toEqual(EMPTY_LEAF_STATE);
		expect(readLeafState({ tableId: 7, viewId: {} })).toEqual(EMPTY_LEAF_STATE);
		expect(readLeafState({ tableId: 'tbl_x' })).toEqual({ tableId: 'tbl_x', viewId: null });
	});

	it('carries no document data: the two keys are a place, not a value', () => {
		expect(Object.keys(WORKSPACE_VIEW_STATE).sort()).toEqual(['tableId', 'viewId']);
		expect(Object.keys(EMPTY_LEAF_STATE).sort()).toEqual(['tableId', 'viewId']);
	});
});

describe('the native file view touches no Bases artifact', () => {
	/** Every source file of the native path. `main.ts` is excluded — the legacy Bases path lives there until R6. */
	function nativeSources(): string[] {
		const adapters = readdirSync(new URL('src/adapters/tablifyFile/', ROOT))
			.filter((name) => name.endsWith('.ts'))
			.map((name) => `src/adapters/tablifyFile/${name}`);
		return [...adapters, 'src/plugin/TablifyFileView.ts', 'src/plugin/viewState.ts'];
	}

	const BANNED: readonly (readonly [string, RegExp])[] = [
		['a Bases view type', /\bBasesView\b/],
		['Bases registration', /registerBasesView/],
		['frontmatter writes', /processFrontMatter/],
		// Single or double quotes mean code; the backticked mentions in these files' own prose are how
		// they say they do *not* touch one.
		['a .base file extension', /['"]\.base['"]|\bbase['"]\s*\)/],
		['a note-backed row source', /\bRowSource\b/],
		['a metadata cache read', /getFileCache|metadataCache/],
	];

	it('scans the files it claims to scan', () => {
		const files = nativeSources();
		expect(files).toContain('src/plugin/TablifyFileView.ts');
		expect(files).toContain('src/plugin/viewState.ts');
		expect(files).toContain('src/adapters/tablifyFile/session.ts');
		expect(files.length).toBeGreaterThanOrEqual(8);
	});

	it('never reaches for a Bases artifact, in any of its forms', () => {
		for (const [what, pattern] of BANNED) {
			for (const file of nativeSources()) {
				const text = readFileSync(new URL(file, ROOT), 'utf8');
				// `basename` is a `TFile` property and must not be caught by the `.base` pattern.
				const cleaned = text.replace(/\bbasename\b/g, 'fileName');
				expect(pattern.test(cleaned), `${file} reaches for ${what}`).toBe(false);
			}
		}
	});

	it('keeps every adapter host-free except the one that implements the port', () => {
		// Inside `src/adapters/tablifyFile/**` exactly one file may import `obsidian` — the adapter that
		// implements the port. If a second one ever does, the port has stopped being the seam. The two
		// plugin files are excluded: a `FileView` and a policy module are supposed to know about the app.
		const adapters = nativeSources().filter((file) => file.startsWith('src/adapters/'));
		const importing = adapters.filter((file) =>
			/from 'obsidian'/.test(readFileSync(new URL(file, ROOT), 'utf8')),
		);
		expect(importing).toEqual(['src/adapters/tablifyFile/vaultPort.ts']);
	});
});
