/**
 * The release screenshots: `docs/images/*.png`, captured from the **harness page** rather than from an editor
 * window, because the harness is the only place this plugin can be rendered outside Obsidian (and because a
 * screenshot taken through a debugger is a screenshot nobody can reproduce).
 *
 * Six images, the names `prompts/step-27` asks for. `docs/09-publishing.md` requires screenshots in the README and
 * does not name them, so these are the names:
 *
 *   · `desktop-light`    — the 1440 × 900 fixture, default theme, no scroll
 *   · `desktop-dark`     — the same fixture with `body.theme-dark`
 *   · `phone-389`        — the phone fixture (390 px host, 389 px pane): nothing pinned, gutter in the scrolling
 *                          lane, `docs/08` §P21's whole point
 *   · `tablet-light`     — the 834 × 1112 fixture
 *   · `conflict-review`  — the real `ConflictReviewDialog` over a three-conflict fixture (the harness's `?shot=`
 *                          mode)
 *   · `import-preview`   — the real `ImportWizard` on its **preview** step over a twelve-row sheet
 *
 * Run:
 *
 *     bun run harness:build && bun run harness:serve &      # or reuse a running server
 *     node harness/shots.mjs
 *
 * **What gets photographed matters.** The grid shots are the host fixture (`.harness-frame`). The two dialogs are
 * Obsidian `Modal`s: they mount into `<body>`, so they are *outside* the frame — and photographing the frame
 * instead produced three byte-identical 162,292-byte PNGs the first time this ran, which is precisely the failure
 * a screenshot cannot show you. So each dialog shot photographs `.modal-container` and waits for a string only the
 * real surface renders (`expect`), and an empty `.modal-content` throws rather than writing a PNG.
 *
 * The images are captured at the fixture's own size, scaled 1:1, with animation disabled and the caret hidden — so
 * a diff against yesterday's image is a difference in the product.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PORT = 4173;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const OUT = 'docs/images';

/** The six shots: URL query, output name, what to photograph, and the string that proves it rendered. */
const SHOTS = [
	{
		name: 'desktop-light',
		query: '?host=desktop',
		label: 'desktop light',
		viewport: { width: 1440, height: 900 },
		frame: '.harness-frame',
		expect: null,
	},
	{
		name: 'desktop-dark',
		query: '?host=desktop-dark',
		label: 'desktop dark',
		viewport: { width: 1440, height: 900 },
		frame: '.harness-frame',
		expect: null,
	},
	{
		name: 'phone-389',
		query: '?host=phone-closed',
		label: 'phone (390 px host, 389 px pane)',
		viewport: { width: 390, height: 844 },
		frame: '.harness-frame',
		expect: null,
	},
	{
		name: 'tablet-light',
		query: '?host=tablet',
		label: 'tablet light',
		viewport: { width: 834, height: 1112 },
		frame: '.harness-frame',
		expect: null,
	},
	{
		name: 'conflict-review',
		query: '?host=desktop&shot=conflict-review',
		label: 'conflict review',
		viewport: { width: 1440, height: 900 },
		frame: '.modal-container',
		expect: 'Review changes',
	},
	{
		name: 'import-preview',
		query: '?host=desktop&shot=import-preview',
		label: 'import preview',
		viewport: { width: 1440, height: 900 },
		frame: '.modal-container',
		expect: 'Import',
	},
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1, reducedMotion: 'reduce' });

for (const shot of SHOTS) {
	await page.setViewportSize(shot.viewport);
	await page.goto(`${BASE}/${shot.query}`);
	await page.waitForFunction(() => '__harness' in window);
	await page.evaluate(async () => window.__harness.ready);
	// Two frames after `ready`: the shot mode opens its dialog on the frame *after* the first paint.
	await page.evaluate(
		() =>
			new Promise((resolve) => {
				window.requestAnimationFrame(() => {
					window.requestAnimationFrame(() => {
						resolve(true);
					});
				});
			}),
	);
	if (shot.expect !== null) {
		await page.locator('.modal-container').getByText(shot.expect).first().waitFor();
		const content = (await page.locator('.modal-container .modal-content').textContent()) ?? '';
		if (content.trim().length === 0) {
			throw new Error(
				`${shot.name}: the dialog rendered no content — refusing to write that PNG`,
			);
		}
	}
	const frame = page.locator(shot.frame);
	const size = await frame.boundingBox();
	const buffer = await frame.screenshot({ animations: 'disabled', caret: 'hide' });
	writeFileSync(`${OUT}/${shot.name}.png`, buffer);
	process.stdout.write(
		`${shot.name}.png — ${shot.label} — ${String(
			size === null ? 0 : Math.round(size.width),
		)} × ${String(size === null ? 0 : Math.round(size.height))} px, ${String(
			Math.round(buffer.byteLength / 1024),
		)} KB\n`,
	);
}

await browser.close();
