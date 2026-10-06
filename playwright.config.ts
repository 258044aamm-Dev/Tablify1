/**
 * Playwright, for the layout harness (`docs/07` §Tier 4).
 *
 * **One project per viewport fixture**, and the fixture is the project: the viewport *is* the host's size, so the
 * page can never have a scrollbar of its own and "the root fills its host" is a question about the plugin rather
 * than about the window. `touch` is on for the phone and tablet fixtures, because `@media (pointer: coarse)` is
 * how the platform says "tap targets"; a desktop with a mouse must not be handed 44 px buttons because a test
 * said "phone".
 *
 * Decisions worth stating:
 *
 *   · **`webServer` reuses an existing server.** `bun run harness:serve` starts the same static server, so a
 *     person can leave one running and iterate; CI starts its own. `test:layout` builds the harness *and* the
 *     plugin's `styles.css` before Playwright starts, so the page always renders the current stylesheet.
 *   · **One worker.** The suite measures time (assertion 11's 2 s budget) and pixels; a second worker competing
 *     for the CPU would make both numbers about the machine.
 *   · **No retries, no `test.skip`, no `--update-snapshots` in CI.** A flaky layout test is a layout bug with a
 *     schedule — the tolerance below is the only slack in the suite, and it is a percent of pixels, not a waiver.
 *     `test-results/` and `playwright-report/` are already gitignored.
 *   · **Snapshots live in `tests/layout/__screenshots__/`** (`{projectName}-{arg}.png`), committed, one per
 *     viewport, and regenerated only by an explicit local `--update-snapshots` run whose reason is written down.
 */
import { defineConfig } from '@playwright/test';

import { HOSTS, HOST_ORDER } from './harness/hosts';

const PORT = 4173;
const baseURL = `http://127.0.0.1:${String(PORT)}`;

export default defineConfig({
	testDir: 'tests/layout',
	// Baselines are committed next to the spec that uses them, named per project — see the header.
	snapshotPathTemplate: 'tests/layout/__screenshots__/{projectName}-{arg}{ext}',
	outputDir: 'test-results',
	fullyParallel: false,
	workers: 1,
	retries: 0,
	forbidOnly: Boolean(process.env.CI),
	// The 200-keystroke and 5,000-row assertions are real work rather than slow network; a minute is generous.
	timeout: 90_000,
	reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
	expect: {
		timeout: 10_000,
		toHaveScreenshot: {
			// A screenshot differs by antialiasing long before it differs by layout. 0.2 of the per-pixel colour
			// distance and at most 0.2 % of pixels: enough for a font hinting difference, far too little to hide a
			// column that moved, a row that jumped or a colour that changed.
			threshold: 0.2,
			maxDiffPixelRatio: 0.002,
			animations: 'disabled',
			caret: 'hide',
			scale: 'css',
		},
	},
	use: {
		baseURL,
		// Traces and videos are for debugging a failure; on a green run they are only artefacts nobody reads.
		trace: 'off',
		video: 'off',
		screenshot: 'off',
		deviceScaleFactor: 1,
	},
	webServer: {
		command: 'bun run harness:serve',
		port: PORT,
		reuseExistingServer: true,
		timeout: 30_000,
	},
	projects: HOST_ORDER.map((id) => {
		const host = HOSTS[id];
		return {
			name: id,
			use: {
				viewport: { width: host.width, height: host.height },
				hasTouch: host.touch,
				isMobile: false,
				colorScheme: host.theme === 'theme-dark' ? 'dark' : 'light',
				userAgent: undefined,
			},
		};
	}),
});
