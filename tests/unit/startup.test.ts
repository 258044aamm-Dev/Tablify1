/**
 * The startup proof: **the sync feature is not on the path that loads the plugin.**
 *
 * Step 26 asks for two things here, and each needs a technique that would survive a hostile reading:
 *
 *  1. *"the sync module is not imported on the startup path"* — asserted **twice**, structurally and at runtime:
 *     · structurally, by building the plugin with `esbuild` (the same entry point and options as
 *       `esbuild.config.mjs`) and reading the **metafile** esbuild writes: every import edge out of
 *       `src/plugin/main.ts` is listed with its `kind`, so "no `import-statement` edge into `src/sync/**`" is a
 *       statement about the graph the bundler actually resolved rather than about the text of the file;
 *     · at runtime, by mocking `src/plugin/sync/host.ts` and counting how many times the module is **evaluated**
 *       and how many times `createSyncHost` is **called**: nothing happens with no link file, and exactly one of
 *       each happens the moment one exists.
 *  2. *"two startup measurements — with no link and with a link present"* — taken with `performance.now()` around
 *     the two things a person waits for: the plugin's `onload` (the module graph above it is already evaluated by
 *     then, which is what "startup path" means here) and the badge's own work. They are measured **once at module
 *     load** so the numbers appear in the test names: this repo forbids `console.*` everywhere, tests included
 *     (`query-table.test.ts` established the pattern), so a measurement that has to be pasted into a report goes
 *     where the runner prints it.
 *
 * ## What is *not* claimed
 *
 * Two honest limits, both measured rather than assumed. First, in `cjs` format esbuild **inlines** a dynamic chunk:
 * the provider client's code is in the shipped `main.js` even though nothing imports it at startup, so what the
 * dynamic import buys today is a lazily *evaluated* module and a clean graph, not bytes. That is asserted below
 * (it is the reason the claim is worded carefully) rather than left in a report where it could be forgotten.
 * Second, this is Node and not a browser: the numbers are the plugin's own work, not a frame painted by Obsidian.
 */
import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

import TablifyPlugin, { LINK_FOLDER_MIRROR } from '../../src/plugin/main';
import { LINK_FOLDER } from '../../src/sync/LinkStore';
import { Plugin } from '../mocks/obsidian';

/** The two counters the runtime half needs. `vi.hoisted`, because `vi.mock`'s factory runs before the imports. */
const spy = vi.hoisted(() => ({
	evaluations: 0,
	hostBuilds: 0,
}));

vi.mock('../../src/plugin/sync/host', async (importOriginal) => {
	spy.evaluations += 1;
	const real = await importOriginal<typeof import('../../src/plugin/sync/host')>();
	return {
		...real,
		createSyncHost: (options: Parameters<typeof real.createSyncHost>[0]) => {
			spy.hostBuilds += 1;
			return real.createSyncHost(options);
		},
	};
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
	/**
	 * The same phase again, with the sync module already evaluated.
	 *
	 * Two numbers rather than one, because they mean different things and only the second is a startup cost: the
	 * first `import('./sync/host')` in this file also pays **this harness's** one-time cost (Vite transforming that
	 * module and its dependencies), which a real Obsidian has already paid when it read `main.js` off disk. The
	 * cached number is what a person waits for on the second start of the day.
	 */
	readonly withLinkCachedMs: number;
	readonly loadedWithoutLink: boolean;
	readonly loadedWithLink: boolean;
	/** How many times the module was evaluated during the measured phases: one, or the claim is broken. */
	readonly evaluations: number;
	/** Microtasks the cached badge path needed, from the ready callback to the host being built. */
	readonly badgeTurns: number;
	readonly hostBuildsWithoutLink: number;
	readonly hostBuildsWithLink: number;
	readonly bundle: BundleFacts;
};

/** Milliseconds, to one decimal place: enough to compare two runs, not so much that the name drowns in digits. */
function ms(value: number): string {
	return `${value.toFixed(1)} ms`;
}

/**
 * Flushes **microtasks** until `done()` answers true, and answers how many turns it took.
 *
 * The alternative is a polling wait (`vi.waitFor`), and it is the wrong tool for timing: it waits on a timer, so a
 * three-microtask chain measures as a whole poll interval (the first version of this file reported 49.6 ms for work
 * that takes a fraction of one). Draining microtasks measures the code's own work — and the turn count is returned
 * so a chain that never settles fails loudly instead of timing out.
 */
async function flushUntil(done: () => boolean, limit = 200_000): Promise<number> {
	let turns = 0;
	while (!done() && turns < limit) {
		await Promise.resolve();
		turns += 1;
	}
	if (!done()) {
		throw new Error(`the async chain did not settle within ${String(limit)} microtasks`);
	}
	return turns;
}

async function measure(): Promise<StartupMeasurement> {
	const bundle = await bundleFacts();

	// Phase 1 — a vault that has never synced: the badge lists the link folder, finds nothing, and stops.
	const evaluationsBefore = spy.evaluations;
	const buildsBefore = spy.hostBuilds;
	const noLinkStart = performance.now();
	const without = loadPlugin([]);
	without.state.readyCallbacks[0]?.();
	await flushUntil(() => without.state.lists > 0);
	const noLinkMs = performance.now() - noLinkStart;
	const loadedWithoutLink = spy.evaluations > evaluationsBefore;

	// Phase 2 — one link file: the badge loads the sync module and asks it for the text.
	// The **first** dynamic import in this file pays the harness's transform cost (Vite compiling the module and
	// its graph from source), which is I/O and therefore not measurable by draining microtasks. It is measured with
	// a polling wait, and both facts are in the report: the plugin's own work is the cached number below.
	const withLinkStart = performance.now();
	const withLink = loadPlugin(['0123456789abcdef.json']);
	withLink.state.readyCallbacks[0]?.();
	await vi.waitFor(() => {
		expect(spy.hostBuilds).toBeGreaterThan(buildsBefore);
	});
	const withLinkMs = performance.now() - withLinkStart;
	const loadedWithLink = spy.evaluations > evaluationsBefore;
	const evaluationsAfter = spy.evaluations;
	const hostBuildsWithLink = spy.hostBuilds - buildsBefore;

	// Phase 3 — the same thing again, now that the module is evaluated: the steady-state cost of the badge.
	const cachedStart = performance.now();
	const builtSoFar = spy.hostBuilds;
	const cached = loadPlugin(['fedcba9876543210.json']);
	cached.state.readyCallbacks[0]?.();
	// The observable end of this phase is the second host: with no Bases leaf open, `updateStatus` answers without
	// touching storage at all (the view check comes first), so the host build *is* the last step of the badge path.
	const turns = await flushUntil(() => spy.hostBuilds > builtSoFar);
	const withLinkCachedMs = performance.now() - cachedStart;

	return {
		noLinkMs,
		withLinkMs,
		withLinkCachedMs,
		loadedWithoutLink,
		loadedWithLink,
		// One evaluation for the whole session: the module is cached after the first dynamic import.
		evaluations: evaluationsAfter - evaluationsBefore,
		// How many microtasks the cached badge path needed. In the name, because it is the shape of the work: a
		// handful of turns means the badge is a couple of awaits, not a chain of chained promises.
		badgeTurns: turns,
		hostBuildsWithoutLink: buildsBefore,
		hostBuildsWithLink,
		bundle,
	};
}

const STARTUP: StartupMeasurement = await measure();

describe('the startup path', () => {
	it(`runs onload and the badge with no link in ${ms(STARTUP.noLinkMs)}, and loads no sync module`, () => {
		// The whole claim in one assertion: with an empty link folder, the module was never evaluated and no host
		// was ever built — the plugin did its work and stopped.
		expect(STARTUP.loadedWithoutLink).toBe(false);
		expect(STARTUP.hostBuildsWithoutLink).toBe(0);
		expect(STARTUP.noLinkMs).toBeGreaterThanOrEqual(0);
	});

	it(`loads the sync module once a link exists (${ms(STARTUP.withLinkCachedMs)} over ${String(STARTUP.badgeTurns)} microtasks; first import, harness included: ${ms(STARTUP.withLinkMs)})`, () => {
		expect(STARTUP.loadedWithLink).toBe(true);
		expect(STARTUP.evaluations).toBe(1);
		expect(STARTUP.hostBuildsWithLink).toBe(1);
		// One host per plugin instance, built on the first thing that needs it: the *module* is evaluated once per
		// session (above), the host is memoised inside `onload`'s own closure, and neither happens twice.
	});

	it(`keeps every sync module off the static import graph (${String(STARTUP.bundle.staticSyncEdges.length)} static, ${String(STARTUP.bundle.dynamicSyncEdges.length)} dynamic)`, () => {
		expect(STARTUP.bundle.staticSyncEdges).toEqual([]);
		// The dynamic edges are the entry points, named: the panel's host, and the native table's command (R5 Part C).
		// Each is loaded only inside its own command handler; a third one would need a deliberate decision here.
		expect(STARTUP.bundle.dynamicSyncEdges).toEqual([
			'src/plugin/sync/host.ts',
			'src/plugin/sync/nativeCommand.ts',
		]);
	});

	it(`measures the cjs inlining honestly (${String(STARTUP.bundle.rawBytes)} B raw, ${String(STARTUP.bundle.gzipBytes)} B gzip, client inlined: ${String(STARTUP.bundle.clientInlined)})`, () => {
		// Not an aspiration: the number and the fact, so that a later step which lifts the `cjs` constraint has to
		// update the wording in `src/plugin/sync/host.ts` in the same commit as this assertion.
		expect(STARTUP.bundle.clientInlined).toBe(true);
		expect(STARTUP.bundle.rawBytes).toBeGreaterThan(0);
	});

	it(`mirrors the link folder (${LINK_FOLDER_MIRROR}) without importing it`, () => {
		// The mirror exists so that `main.ts` has no import edge into `src/sync/**` (asserted above). This is what
		// keeps the mirror from drifting: the two constants are compared here, once.
		expect(LINK_FOLDER_MIRROR).toBe(LINK_FOLDER);
		expect(LINK_FOLDER_MIRROR.startsWith('.')).toBe(true);
	});

	it('the sync command loads the feature even with no link file, because a person asked for it', async () => {
		const before = spy.hostBuilds;
		const { plugin, state } = loadPlugin([]);
		const command = plugin.commands.find((entry) => entry.id === 'open-sync-panel');
		expect(command?.name).toBe('Open the sync panel');
		expect(command).toBeDefined();
		command?.callback();
		await vi.waitFor(() => {
			expect(spy.hostBuilds).toBeGreaterThanOrEqual(before + 1);
		});
		// No Bases leaf, so the host's `open()` cannot find a view — and its port says so instead of throwing.
		expect(state.listeners).toContain('active-leaf-change');
	});
});
