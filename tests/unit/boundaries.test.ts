/**
 * The architecture is enforced by lint, and a lint rule that nobody has ever seen fire is a wish. So this
 * test writes real violations into the real directories at runtime, lints them through ESLint's Node API,
 * and deletes them again. If someone later loosens a pattern in `eslint.config.mts`, or adds a config
 * object that quietly replaces another one's `no-restricted-imports` option (which is not merged — that
 * exact mistake was made and caught on 2026-10-05), the probe stops failing and this test goes red.
 *
 * ESLint's Node API reports `errorCount` per file; the CLI turns any error into a non-zero exit, which is
 * what `bun run check` gates on, so an assertion on `severity === 2` is the assertion on the exit code.
 */
import { ESLint } from 'eslint';
import { mkdir, rmdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RULE = 'no-restricted-imports';

type Probe = {
	/** Repository-relative path of the file to write. */
	path: string;
	/** Its exact contents. */
	code: string;
	/** A fragment of the message that must be reported, or null when nothing may be reported. */
	expectMessage: string | null;
	/** What the case is about, for the test name. */
	because: string;
};

const OBSIDIAN_IMPORT =
	"import { Notice } from 'obsidian';\nexport const announce = (text: string) => new Notice(text);\n";
const REACT_IMPORT =
	"import { useState } from 'react';\nexport const useProbe = () => useState<number>(0);\n";

const PROBES: Probe[] = [
	{
		path: 'src/core/__boundary-probe-obsidian.ts',
		code: "import { Plugin } from 'obsidian';\nexport const probe: typeof Plugin | null = null;\n",
		expectMessage: 'src/core must stay pure: it may not import the Obsidian API',
		because: 'the core is pure TypeScript and never touches the app',
	},
	{
		path: 'src/core/__boundary-probe-react.ts',
		code: REACT_IMPORT,
		expectMessage: 'src/core must stay pure: it may not import React',
		because: 'the core does not render, so it does not depend on React',
	},
	{
		path: 'src/core/__boundary-probe-clean.ts',
		code: 'export const add = (a: number, b: number): number => a + b;\n',
		expectMessage: null,
		because: 'an ordinary core module is not flagged, so the rule is not matching everything',
	},
	{
		path: 'src/adapters/__boundary-probe-react.ts',
		code: REACT_IMPORT,
		expectMessage: 'src/adapters must stay renderable-free: no React',
		because: 'adapters read and write data and never render',
	},
	{
		path: 'src/grid/__boundary-probe-obsidian.ts',
		code: OBSIDIAN_IMPORT,
		expectMessage:
			'The grid may import `obsidian` only in src/grid/menus/** or src/grid/dialogs/**',
		because: 'the grid is ordinary React over the core, outside the two bridge modules',
	},
	{
		path: 'src/grid/menus/__boundary-probe-obsidian.ts',
		code: OBSIDIAN_IMPORT,
		expectMessage: null,
		because: 'the bridge modules are allowed to reach the app',
	},
	{
		path: 'src/grid/dialogs/__boundary-probe-obsidian.ts',
		code: OBSIDIAN_IMPORT,
		expectMessage: null,
		because: 'the second bridge module is allowed to reach the app',
	},
	{
		path: 'src/grid/menus/__boundary-probe-prototype.ts',
		code: "import { layoutChrome } from '../../../docs/legacy/prototype/js/grid.js';\nexport const chrome = layoutChrome;\n",
		expectMessage:
			'docs/legacy/** (the frozen prototype and the historical records) and tools/** are outside the module graph',
		because: 'the bridge exemption does not also exempt the frozen prototype',
	},
	{
		path: 'tests/unit/__boundary-probe-grid.ts',
		code: "import { createStore } from '../../src/grid/store';\nexport const store = createStore;\n",
		expectMessage: 'Only tests/dom may import src/grid',
		because: 'a unit test cannot exercise the React grid, so it must not import it',
	},
	{
		path: 'tests/dom/__boundary-probe-grid.ts',
		code: "import { createStore } from '../../src/grid/store';\nexport const store = createStore;\n",
		expectMessage: null,
		because: 'tests/dom is where grid behaviour is asserted with a DOM',
	},
	{
		path: 'tests/unit/__boundary-probe-prototype.ts',
		code: "import { FIELD_TYPES } from '../../docs/legacy/prototype/js/data.js';\nexport const types = FIELD_TYPES;\n",
		expectMessage:
			'docs/legacy/** (the frozen prototype and the historical records) and tools/** are outside the module graph',
		because: 'the prototype is not a dependency of the test suite either',
	},
];

const messagesByPath = new Map<
	string,
	{ ruleId: string | null; severity: number; message: string }[]
>();

beforeAll(async () => {
	const eslint = new ESLint({ cwd: ROOT });
	// Write, or overwrite — a run that was killed mid-flight must not leave a file that breaks the probe.
	for (const probe of PROBES) {
		await mkdir(dirname(join(ROOT, probe.path)), { recursive: true });
		await writeFile(join(ROOT, probe.path), probe.code, 'utf8');
	}
	const results = await eslint.lintFiles(PROBES.map((probe) => probe.path));
	for (const result of results) {
		messagesByPath.set(relative(ROOT, result.filePath), result.messages);
	}
}, 120_000);

/** Removes a directory only while it is empty. */
async function removeEmptyDir(path: string): Promise<void> {
	try {
		await rmdir(path);
	} catch {
		// ENOTEMPTY means something real lives there (a module, or another test's file) and ENOENT means
		// it never existed. Either way this test may only remove what it created, and only while empty.
	}
}

afterAll(async () => {
	await Promise.all(PROBES.map((probe) => rm(join(ROOT, probe.path), { force: true })));
	// Deepest first, so `src/grid/menus` goes before `src/grid` is considered.
	await Promise.all(
		[...new Set(PROBES.map((probe) => dirname(join(ROOT, probe.path))))]
			.sort((a, b) => b.length - a.length)
			.map((path) => removeEmptyDir(path)),
	);
});

describe('the boundary rules are real', () => {
	it('lints every probe (so the assertions below are about rules, not about missing files)', () => {
		expect(messagesByPath.size).toBe(PROBES.length);
	});

	for (const probe of PROBES) {
		it(`${probe.expectMessage === null ? 'allows' : 'blocks'} ${probe.path} — ${probe.because}`, () => {
			const messages = messagesByPath.get(probe.path);
			expect(messages).toBeDefined();
			const boundary = (messages ?? []).filter((message) => message.ruleId === RULE);
			if (probe.expectMessage === null) {
				expect(boundary).toEqual([]);
				return;
			}
			expect(boundary.length).toBeGreaterThan(0);
			const first = boundary[0];
			expect(first?.severity).toBe(2);
			expect(first?.message).toContain(probe.expectMessage);
		});
	}
});
