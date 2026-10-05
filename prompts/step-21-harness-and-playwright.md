Task: build the committed layout harness — the static page that mounts the **real** `GridView` against a
fixture `RowSource`, and the Playwright spec that asserts all thirteen Tier-4 rules across all five
viewports. From this step on, every layout or interaction fix must land with a new assertion here.

Read first: `docs/07-test-plan.md` §Tier 4 (the thirteen assertions and the five viewports — this is the
spec), §Tier 5 (what stays manual), `docs/04` §the viewport matrix (the exact sizes and the simulated
chrome), `docs/05` §the harness commands (`harness:serve`, `test:layout`, the Playwright config).

Deliverable:

1. `harness/index.html` + `harness/mount.tsx` — a static page that mounts the real `GridView` with a
   fixture `RowSource` (5,000 × 20 rows available, data generated deterministically from a seed), styled by
   a **stub Obsidian theme stylesheet** (`harness/obsidian-stub.css`: the host variables the plugin
   consumes, in light and dark) plus the plugin's real `styles.css`. The page must expose a small
   `window.__harness` API for the spec: `setRows(n)`, `setView(patch)`, `getScroll()`, `focusCell(r, c)`,
   `renderCounts()`. Nothing in `harness/**` may be imported by `src/**`.
2. `harness/hosts.ts` — the five viewport fixtures from the doc: `desktop` (1280×800), `desktop-dark`,
   `phone-closed` (390×844 with the simulated chrome), `phone-keyboard` (the host squeezed to **389 px** —
   the historical failure), `tablet` (834×1112). Each fixture is a named host wrapper around the mount
   point with the chrome the doc describes, so the plugin sees a pane of the documented width.
3. `playwright.config.ts` — projects, one per viewport fixture, `webServer: { command: "bun run
   harness:serve", port: 4173, reuseExistingServer: true }`, `expect.toHaveScreenshot` settings with the
   tolerance the doc names, and a `--reporter=list` default that prints assertions in CI.
4. `tests/layout/tier4.spec.ts` — the thirteen assertions, one `test()` each, named after the doc's row so
   a failure names the rule. Every assertion must measure, never assume:
   1. the root fills its host's padding box (compare `getBoundingClientRect` to the host's computed padding
      box, allow 0 px difference),
   2. in `phone-keyboard` the host is 389 px and the root still fills it,
   3. the header stays aligned after 500 px horizontal scroll and after 1,000 px vertical scroll,
   4. the frozen column drifts ≤ 1 px against the header after the same scrolls,
   5. the toolbar is single-row and fully visible, and the overflow menu appears below 520 px,
   6. every input/editor reports `font-size ≥ 16px`,
   7. every interactive target ≥ 44×44 px on the phone viewports,
   8. no computed style contains `!important`, plus the static check on `styles.css`,
   9. 200 arrow presses keep the active cell in view, keep exactly one focused element, and never scroll
      the page,
   10. typing in a cell does not move the scroll position,
   11. a 400×6 paste completes in under 2 s on the fixture,
   12. inserting and removing a row does not scroll-jump,
   13. screenshot diff against committed baselines, per viewport.
   Baselines go in `tests/layout/__screenshots__/` and are committed; state in the report how many there are
   and how they were generated.
5. `bun run test:layout` wired to run: build the harness, serve it, run the spec. Add it to
   `.github/workflows/ci.yml` **now** (step 04 deliberately left it conditional — remove that condition in
   this step and say so).
6. `PROGRESS.md` updated (M3 complete → internal beta; the thirteen assertion results per viewport).

Constraints and fence:
- Touch `harness/**`, `tests/layout/**`, `playwright.config.ts`, `package.json`,
  `.github/workflows/ci.yml`, `PROGRESS.md`.
- The harness must consume the **real** components and the **real** `styles.css`; a fixture that reimplements
  a component invalidates the whole gate. If a component needs a seam to be mountable, add the seam in
  `src/**` and report it.
- No `test.skip`, no `test.fixme`, no `--update-snapshots` in CI, no tolerance widened to make a failure
  pass. A failing assertion is fixed in `src/**`.
- No new dependency other than `@playwright/test` (ask with the version, then add).

STOP and report instead of proceeding if: an assertion cannot be measured headlessly (say which and why);
or the 389 px fixture cannot reproduce the historical failure (then the host simulation is wrong — report
the measured numbers instead of adjusting the assertion); or a baseline diff is unstable across runs on
your machine (report the variance).

Acceptance (paste raw output):
- `bun run check` — green.
- `bun run test:layout` — the full list output, with all thirteen assertions per viewport and the pass
  count. If anything is red, paste the failure and stop: do not adjust the assertion to match the bug.
- The five host widths as measured inside the page, proving the fixtures are what the doc says.
- The render-count numbers for assertions 9 and 10.

REPORT BACK with: the file list; the raw gate output; the layout run output; the baseline count; the
measured host widths; the CI change you made; anything ASSUMED (device-specific behaviour especially);
the exact next step — and remember: from now on every fix lands with an assertion here.
