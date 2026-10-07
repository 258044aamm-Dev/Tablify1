# Prototype freeze — 2026-10-05

> **Historical scope only:** this freeze applies to the legacy static prototype described below. It does not define or authorize work on the native `.tablify` product. Preserve this record; use `docs/04-design-system-and-layout.md` and the R-phase guides for any future design work.

**The instruction, in the user's words:** some UI needs redesigning, but the freeze holds — *the redesign
happens after the current run of work*; no work may touch the current design in a way that breaks the
interaction or the look; **no side-effects on the shared core**; the focus is **`index.html` plus its
parts**. Unfreezing is a new phase with a dedicated message.

## What is frozen

The look of the prototype's own surfaces: `prototype/index.html`, `prototype/css/*` and the DOM the
screens render into (`#view-host`, `#editor-host`, `#legacy-host`, `#settings-host`, plus the portalled
`#modal-host`, `#menu-host`, `#toast-host`). Concretely: no re-layout, no re-skin, no new component
language, no icon or typeface swap **while the freeze is in force**.

## What is still allowed while frozen

| allowed | why |
| --- | --- |
| Accessibility fixes that do not change the look (focus return, `Escape` handling, labels, `aria` state, hit sizes) | they are correctness, and the freeze names accessibility as permitted |
| Test work: new checks, new fixtures, new harnesses, doc reconciliation | proving the build is not a design change |
| Performance work with identical output (windowed rendering, event cost, no new paint) | the 5,000-row contract is a behaviour, not a style |
| Bug fixes that restore the *documented* behaviour of an existing surface | a defect is not a design decision |

Anything else — a new colour, a moved control, a different type scale, a restyle — goes to
`PLAN-style-audit-notes` and waits for the unfreeze message.

## The guard on every change

1. **Both suites must end green**: `node tests/smoke.js` → `PASS (37)` and
   `node tests/interaction-audit.js` → `N passed, 0 failed, N total`, plus
   `node tests/scroll-verification.js` → `PAGE ERRORS: none` and `node tools/contrast.js` → all gated
   pairs pass.
2. **Nothing asserted may be renamed or left out**: the `⋯ ✕ ✓ ▸` glyphs, `.toast`, `.menu .menu-item`,
   `.opt-row`, `.pop-item`, the `.tablify-*` class and `data-*` contracts, and the store's public API.
   Presentation-only edits must not change behaviour; behavioural edits must come with a check.
3. **No infinite loops or unbounded timers.** A suite that does not finish is a failure, not a slow pass.
   New code may not add a loop whose bound is not a constant or a collection length, and no new
   `setInterval`. The one debounce in the build (the 260 ms save) stays a debounce.
4. **A stage is closed by evidence, not by intent**: re-run the four commands above (and quote their
   numbers in `DESIGN-REVIEW.md`) before calling a stage done.
5. **No side-effects on the shared core.** `js/store.js`, `js/grid.js` and `js/dialogs.js` are shared by
   the grid, the legacy screen, the settings tab and the harness; a change for one screen may not alter
   what another screen — or another mounted grid in the same document — sees.

## Standing rule for the real plugin

The same rule applies to `docs/`: a design change is written down as a decision with a rationale before it
is drawn, and the token file (`prototype/css/tokens.css`, whose industrial equivalent is the plugin's
`tokens.css`) stays the only file that owns a colour.

## Current status

| stage | state | evidence |
| --- | --- | --- |
| Stage 1 — colour tokens, one focus ring, contrast gate | done | audit 70/70 at the time, contrast 26/26, `DESIGN-REVIEW.md` §Stage 1 |
| Stage 2 — motion by frequency, hover gating | done | audit 72/72 at the time, checks 71–72, `DESIGN-REVIEW.md` §Stage 2 |
| Settings stage — "Advanced settings → Content", all on by default | done | audit **78/78**, smoke **37/37**, contrast **30/30**, `DESIGN-REVIEW.md` §Settings stage |
| Stage 3 — type + icons + wordmark | next | `PLAN-ui-ux-pass.md` §stages |
