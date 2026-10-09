/**
 * The startup proof: **the sync feature is not on the path that loads the plugin.**
 *
 * The legacy Bases sync host and its status-bar badge were removed in R6 Step 2, so the only sync entry point is
 * the native command (`src/plugin/sync/nativeCommand.ts`), which the command handler imports on demand. Two things
 * are asserted, each by a technique that would survive a hostile reading:
 *
 *  1. *"no sync module is imported on the startup path"*, asserted **twice**, structurally and at runtime:
 *     · structurally, by building the plugin with `esbuild` (the same entry point and options as
 *       `esbuild.config.mjs`) and reading the **metafile**: every import edge out of `src/plugin/main.ts` is listed
 *       with its `kind`, so "no `import-statement` edge into `src/sync/**`" is a statement about the graph the
 *       bundler resolved;
 *     · at runtime, by mocking `src/plugin/sync/nativeCommand.ts` and counting how many times it is **evaluated**:
 *       loading the plugin evaluates it zero times, with or without a link file.
 *  2. *"two startup measurements — with no link and with a link present"*, taken with `performance.now()` around
 *     the plugin's `onload`. They are measured once at module load so the numbers appear in the test names.
 *
 * ## What is *not* claimed
 *
 * In `cjs` format esbuild **inlines** a dynamic chunk: the provider client's code is in the shipped `main.js` even
 * though nothing imports it at startup. What the dynamic import buys is a lazily *evaluated* module and a clean
 * graph, not fewer bytes. That is asserted below, so a later change that lifts the `cjs` constraint has to update it.
 */
import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

import TablifyPlugin from '../../src/plugin/main';
import { LINK_FOLDER } from '../../src/sync/LinkStore';
import { Plugin } from '../mocks/obsidian';

/** The evaluation counter. `vi.hoisted`, because `vi.mock`'s factory runs before the imports. */
const spy = vi.hoisted(() => ({ evaluations: 0 }));

vi.mock('../../src/plugin/sync/nativeCommand', async (importOriginal) => {
	spy.evaluations += 1;
	return importOriginal<typeof import('../../src/plugin/sync/nativeCommand')>();
});

/**
 * The parts of `App` this file's fake provides. Deliberately small: only what `main.ts` touches, and **mutable**,
 * because the fake counts what the plugin does to it.
 */
type FakeApp = {
	lists: number;
	reads: number;
	written: string[];
	readyCallbacks: (() => void)[];
	listeners: string[];
};

type FakeAppPorts = {
	readonly app: unknown;
	readonly state: FakeApp;
};

/** A vault whose `.tablify/links` folder holds exactly `files`, and a workspace with no Bases leaves. */
function fakeApp(files: readonly string[]): FakeAppPorts {
	const state: FakeApp = { lists: 0, reads: 0, written: [], readyCallbacks: [], listeners: [] };
	const app = {
		vault: {
			getMarkdownFiles: (): unknown[] => [],
			// The R2 file port subscribes to the vault on load and resolves paths through it.
			on: (): { readonly name: string } => ({ name: 'vault-event-ref' }),
			offref: (): void => undefined,
			getAbstractFileByPath: (): null => null,
			read: (): Promise<string> => Promise.reject(new Error('no such file')),
			create: (): Promise<never> => Promise.reject(new Error('read-only double')),
			process: (): Promise<string> => Promise.reject(new Error('no such file')),
			adapter: {
				list: (path: string): Promise<{ files: string[]; folders: string[] }> => {
					state.lists += 1;
					return Promise.resolve({
						files: path === LINK_FOLDER ? [...files] : [],
						folders: [],
					});
				},
				read: (): Promise<string> => {
					state.reads += 1;
					return Promise.reject(new Error('no such file'));
				},
				write: (path: string): Promise<void> => {
					state.written.push(path);
					return Promise.resolve();
				},
				exists: (): Promise<boolean> => Promise.resolve(false),
				mkdir: (): Promise<void> => Promise.resolve(),
			},
		},
		workspace: {
			activeLeaf: null,
			// No Bases leaf: the badge path must survive a vault where the grid is not open, which is every start.
			getLeavesOfType: (): unknown[] => [],
			onLayoutReady: (callback: () => void): void => {
				state.readyCallbacks.push(callback);
			},
			on: (name: string): { readonly name: string } => {
				state.listeners.push(name);
				return { name };
			},
		},
	};
	return { app, state };
}

/** A plugin whose `onload` has run against that fake app. The module itself is loaded once, by this file's import. */
function loadPlugin(files: readonly string[]): { plugin: Plugin; state: FakeApp } {
	const { app, state } = fakeApp(files);
	const plugin = new Plugin();
	plugin.app = app;
	Reflect.apply(TablifyPlugin.prototype.onload, plugin, []);
	return { plugin, state };
}

/** The bundle, its metafile, and the one measurement that has to stay visible: is the client inlined anyway? */
type BundleFacts = {
	readonly staticSyncEdges: readonly string[];
	readonly dynamicSyncEdges: readonly string[];
	readonly rawBytes: number;
	readonly gzipBytes: number;
	readonly clientInlined: boolean;
};

/**
 * Builds the plugin exactly as `esbuild.config.mjs` does, without writing anything.
 *
 * The option set is mirrored rather than imported: `esbuild.config.mjs` calls `esbuild.context` at module scope and
 * would start a watcher. A comment cannot keep two option sets in step, so the tests assert what matters instead —
 * the entry point, the resolved graph and the `cjs` format — and a drift in any of those fails here first.
 */
async function bundleFacts(): Promise<BundleFacts> {
	const result = await build({
		banner: { js: '/* generated */' },
		entryPoints: ['src/plugin/main.ts'],
		bundle: true,
		external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
		format: 'cjs',
		platform: 'browser',
		target: 'es2018',
		jsx: 'automatic',
		treeShaking: true,
		metafile: true,
		write: false,
		logLevel: 'silent',
	});
	const text = result.outputFiles?.[0]?.text ?? '';
	const inputs = result.metafile?.inputs ?? {};
	const isSync = (path: string): boolean =>
		path.startsWith('src/sync/') || path.startsWith('src/plugin/sync/');
	const edges = inputs['src/plugin/main.ts']?.imports ?? [];
	const staticSyncEdges = edges
		.filter((edge) => edge.kind !== 'dynamic-import' && isSync(edge.path))
		.map((edge) => edge.path);
	const dynamicSyncEdges = edges
		.filter((edge) => edge.kind === 'dynamic-import' && isSync(edge.path))
		.map((edge) => edge.path)
		// A dynamic edge is a *request*: esbuild records the resolved file, so sorting keeps the assertion stable.
		.sort();
	const bytes = new TextEncoder().encode(text);
	return {
		staticSyncEdges,
		dynamicSyncEdges,
		rawBytes: bytes.byteLength,
		gzipBytes: gzipSync(bytes).byteLength,
		// The measurement behind "a lazily evaluated module, not deferred bytes": the request host only exists in
		// the transport module. `main.js` carries it because `cjs` inlines the dynamic chunk.
		clientInlined: text.includes('api.airtable.com'),
	};
}

/** The two startup phases, measured once at module load (see the file header for why). */
type StartupMeasurement = {
	readonly noLinkMs: number;
	readonly withLinkMs: number;
	/** Sync module evaluations caused by loading the plugin, with no link file. */
	readonly evaluationsWithoutLink: number;
	/** Sync module evaluations caused by loading the plugin, with a link file present. */
	readonly evaluationsWithLink: number;
	readonly bundle: BundleFacts;
};

function ms(value: number): string {
	return `${value.toFixed(2)} ms`;
}

async function measure(): Promise<StartupMeasurement> {
	const before = spy.evaluations;
	const noLinkStart = performance.now();
	const noLink = loadPlugin([]);
	noLink.state.readyCallbacks.forEach((callback) => {
		callback();
	});
	const noLinkMs = performance.now() - noLinkStart;
	const evaluationsWithoutLink = spy.evaluations - before;

	const withLinkBefore = spy.evaluations;
	const withLinkStart = performance.now();
	const withLink = loadPlugin(['0123456789abcdef.json']);
	withLink.state.readyCallbacks.forEach((callback) => {
		callback();
	});
	const withLinkMs = performance.now() - withLinkStart;
	const evaluationsWithLink = spy.evaluations - withLinkBefore;

	return {
		noLinkMs,
		withLinkMs,
		evaluationsWithoutLink,
		evaluationsWithLink,
		bundle: await bundleFacts(),
	};
}

const STARTUP: StartupMeasurement = await measure();

describe('the startup path', () => {
	it(`runs onload with no link in ${ms(STARTUP.noLinkMs)}, and loads no sync module`, () => {
		expect(STARTUP.evaluationsWithoutLink).toBe(0);
		expect(STARTUP.noLinkMs).toBeGreaterThanOrEqual(0);
	});

	it(`runs onload with a link present in ${ms(STARTUP.withLinkMs)}, and still loads no sync module`, () => {
		// The status-bar badge that used to read the link folder at startup is gone, so a link file no longer
		// causes a load. The sync code runs only when the person asks for it.
		expect(STARTUP.evaluationsWithLink).toBe(0);
	});

	it(`keeps every sync module off the static import graph (${String(STARTUP.bundle.staticSyncEdges.length)} static, ${String(STARTUP.bundle.dynamicSyncEdges.length)} dynamic)`, () => {
		expect(STARTUP.bundle.staticSyncEdges).toEqual([]);
		// The one dynamic edge is the entry point, named: the native table's command (R5 Part C). It is loaded only
		// inside its own command handler; a second one would need a deliberate decision here.
		expect(STARTUP.bundle.dynamicSyncEdges).toEqual(['src/plugin/sync/nativeCommand.ts']);
	});

	it(`measures the cjs inlining honestly (${String(STARTUP.bundle.rawBytes)} B raw, ${String(STARTUP.bundle.gzipBytes)} B gzip, client inlined: ${String(STARTUP.bundle.clientInlined)})`, () => {
		// Not an aspiration: the number and the fact, so that a later step which lifts the `cjs` constraint has to
		// update this assertion in the same commit.
		expect(STARTUP.bundle.clientInlined).toBe(true);
		expect(STARTUP.bundle.rawBytes).toBeGreaterThan(0);
	});
});
