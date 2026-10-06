Task: the mobile and accessibility pass — the parts a harness cannot prove. Run the device matrix by hand,
fix what it exposes, and add the assertions the harness *can* hold from then on. Nothing here is allowed to
regress the desktop paths: every fix lands with a Tier-4 assertion or a unit test.

Read first: `docs/07-test-plan.md` §Tier 5 (the manual matrix — this is your checklist), `docs/04` §the
viewport matrix and §touch (hit sizes, the 16 px rule, safe areas), `docs/01-spec.md` §touch
(long-press menus, the selection toggle, the drag thresholds), `docs/08-decisions.md` §P21 (the narrow-pane
unpinning rule: pin nothing below 600 px of pane width, hide the freeze option there),
`prototype/shots/phone-389-nothing-pinned.png` (the reference behaviour on the squeezed host).

Deliverable:

1. Run the manual matrix and record it in `docs/manual-test-log.md` (that file exists for exactly this;
   follow its existing format and append, do not rewrite): desktop Linux/Windows/macOS, the phone
   (390 px and the 389 px host squeeze), the tablet, dark mode, a large vault (5,000+ notes), and a
   reduced-motion / large-text accessibility setting. For each row: what you did, what you saw, and a
   PASS/FAIL with the reason. Never write PASS for something you did not do.
2. Fix everything the log records as FAIL, in `src/**` only, each with its regression guard:
   - touch: long-press opens the documented menu (and a real tap still selects), the drag thresholds are
     ≥ 8 px on touch, the selection toggle works, the fill handle is reachable on a phone,
   - hit sizes: every target ≥ 44×44 px on the phone viewports, including the row gutter, the header menu
     buttons, the scrollbar thumbs and the dialog buttons,
   - inputs: every editor reports `font-size ≥ 16px` (iOS zoom guard) — extend Tier-4 assertion 6 to cover
     the editors mounted inside dialogs, not just the grid,
   - safe areas: the toolbar and status bar respect `env(safe-area-inset-*)` on the phone fixtures,
   - the on-screen keyboard: opening an editor at the bottom of the visible area scrolls it into view and
     does not hide it behind the keyboard (document what you could and could not reproduce; a fixture that
     shoves the host is acceptable as the automated half),
   - the narrow rule: with the pane under 600 px, nothing is pinned, the gutter rides in the lane, and the
     freeze option is **absent** from both the view dialog and the view menu (assert absent, not disabled),
   - the `.base`-sidecar state: switching panes or reopening the base preserves the view config.
3. `tests/layout/tier4.spec.ts` — add the assertions the matrix exposed as automatable: safe-area padding,
   the editor-inside-dialog font size, the long-press path (Playwright can dispatch touch sequences; if it
   cannot, say so and keep the manual row), and the "freeze option absent under 600 px" case.
4. `tests/unit/a11y.test.ts` — the ARIA contract from step 19 held from the outside: roles, indices,
   `aria-readonly`, the live region's politeness, and a check that no element in the grid has a `tabindex`
   above 0.
5. A screenshots folder for the release: capture `desktop-light`, `desktop-dark`, `phone-389`,
   `tablet-light`, `conflict-review`, `import-preview` into `docs/images/` at the sizes the README will
   use, with the same names as `docs/09-publishing.md` lists (if the doc names them).
6. `PROGRESS.md` updated (M6 started; the matrix results with the FAILs fixed and the ones still open).

Constraints and fence:
- Touch `src/**` (fixes), `tests/**`, `docs/manual-test-log.md`, `docs/images/**`, `PROGRESS.md`.
- No cosmetic redesign in this step: it is a correctness pass, and any visual change must be justified by a
  measured failure in the log.
- Every fix is small and surgical; if a fix needs a structural change, stop, describe it, and wait.
- No `any`, no `as`, no `!`.

STOP and report instead of proceeding if: a FAIL cannot be reproduced twice (record it as flaky with both
attempts); or a fix would change the visual design (stop before drawing it); or the phone you have does not
expose the touch sequence needed (say which rows stay manual).

Acceptance (paste):
- `bun run check` — green; `bun run test:layout` — green across all five viewports.
- The appended `docs/manual-test-log.md` section, verbatim, with the device names and versions.
- The list of FAILs found and the guard added for each.
- The screenshot list with file sizes, and the note on which are replaced baselines.

REPORT BACK with: the log; the FAIL → fix → guard table; the new assertions; the screenshots; anything
still manual and why; anything ASSUMED; the exact next step.
