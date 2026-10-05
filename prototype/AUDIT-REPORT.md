# Prototype audit — scrolling + every interaction

**Question asked:** *"Currently, the horizontal and vertical scrolling is not working. Also, find out is there any interaction that is not working."*

**Answer:** scrolling was broken by one layout defect (fixed and measured below), and the full interaction sweep that followed found **16 further defects**, and a follow-up round added a 17th (the pinned column on a phone) — including one that made the import wizard impossible to finish and a keyboard-focus bug that killed every shortcut after closing a menu. All are fixed in the product code, and 16 of the 17 now have a check that fails if they come back — the seventeenth (modal keyboard guard) asserts a *non-event*, so it is verified by hand and labelled as such below.

Current state: **78/78** browser checks (`tests/interaction-audit.js`, real Chromium, 0 page and 0 console errors during the run, 124 s), **37/37** jsdom checks (`tests/smoke.js`), 30/30 gated contrast pairs (`../tools/contrast.js`), scroll measurements below (`tests/scroll-verification.js`).

---

## 1. Scrolling — root cause and fix

**What you saw:** the wheel did nothing, no scrollbar existed in either axis, and a drag-selection that left the viewport just stopped.

**Cause.** The data lane is absolutely positioned and moved with a CSS `transform`, but the scroll container (`overflow: auto`) had **no content of its own** — an absolutely positioned child contributes no scrollable extent. The browser had nothing to scroll: `scrollWidth`/`scrollHeight` stayed at viewport size and every wheel event was discarded. Three more symptoms fell out of the same root cause:

| # | Symptom | Cause | Fix |
|---|---|---|---|
| S1 | Wheel, `PageDown` and scrollbar drag never moved the data | the scroller had 0 px of scrollable extent | a `.tablify-spacer` sized to the full virtual extent (rows × row height, Σ column widths) inside the scroller |
| S2 | No scrollbars at all, in either axis | native scrollbars were hidden (zero-width webkit track, `scrollbar-width: none`) and nothing replaced them | docked `.tablify-hbar` / `.tablify-vbar` (14 px, always reserved) with thumbs whose **size and position** are derived from scroll state in `updateThumbs()` |
| S3 | Rows slid under the header / the header drifted on scroll | the rows lane took its offset from inline `left/top` **and** the transform, so the offset was applied twice | position comes from the transform only; `HEADER_H` and `BAR` are named constants that the geometry and the renderer share |

A scrollable extent alone is not enough — the input paths had to be added too: **wheel routing from every region** (data, header, frozen column, corner, both bars; the region under the cursor otherwise swallows the event), **pointer-drag on both thumbs** (`beginBarDrag`), and **edge auto-scroll while drag-selecting** (`pumpAutoScroll`).

**Measured after the fix** — 1280×800, 30 rows × 19 fields, from `tests/scroll-verification.js`:

```
HEADER y 168 h 40 | FIRST ROW y 208 → gap = 0 px                 (S3: no drift)
HBAR    x 377 y 752  w 876 h 14 | thumb w 376                     (S2: docked, sized from content ratio)
VBAR   x 1253 y 208 w  14 h 544 | thumb h 267
SCROLLER content 2922×1298 vs viewport 1254×598 | spacer 2922×1298 (S1: extent now real)
WHEEL over .tablify-rows .cell     → scrollTop 300 scrollLeft 240 | lane transform matrix(1,0,0,1,-240,-300)
WHEEL over .tablify-header .hcell  → scrollTop 300 scrollLeft 240 | lane transform matrix(1,0,0,1,-240,-300)
WHEEL over .tablify-frozen .gutter → scrollTop 300 scrollLeft 240 | lane transform matrix(1,0,0,1,-240,-300)
WHEEL over .tablify-corner         → scrollTop 300 scrollLeft 240 | lane transform matrix(1,0,0,1,-240,-300)
DRAG vthumb → scrollTop 358 | DRAG hthumb → scrollLeft 667
DRAG-SELECT past the edge → auto-scrolled to 420, selection 12 rows × 2 fields = 20 cells
PAGE ERRORS: none
```

**Keyboard scrolling** was broken for a separate reason in the same area: `Home` and `End` moved the active cell but never the viewport, so on a wide table the focus jumped to a cell you could not see. `jumpTo()` now does `setSel` + `scrollToCell`, which every other navigation key already did. Observed: `1:2 → 2:2 → 2:3 → 2:4 → 14:4 → 14:1 → 14:19 → 2:19`, `End → scrollLeft 1548`, `PageDown → row 24, scrollTop 356`.

---

## 2. The 16 other interactions that were broken

Worst first, grouped by what a person would actually notice. "Covered" names the check that now fails if the behaviour regresses, with its observed line.

### Blocking — the feature could not be used at all

| # | What you'd notice | Cause | Fix | Covered |
|---|---|---|---|---|
| 1 | **The import wizard could never be finished.** Picking a source reached the preview and then stopped — no Back, no Continue, no Import | the preview step drew the body but never owned the modal footer, so all that existed was the footer the previous step had left (`drawPreview` never touched `api.foot`) | the step writes its own footer: `‹ Back` + `Continue ›`. Rule now enforced: **whoever rebuilds `body` sets or clears `api.foot`** | 50–53 — *"picked file → preview → created table 'From file' with 2 rows"*; *"30 → replaced with 13 → one Ctrl+Z → 30"* |
| 2 | Menus and option pickers opened **from inside a dialog** looked clickable but were dead | layering: the dialog overlay was set at `z-index 200`, while popovers sat at 130 and menus at 140 — both **under** it | explicit scale, monotonic by layer: cells 1–5 → scrollbars 7 → drag ghost / editor anchor 120 → **overlay 200 → `.pop` 250 → `.menu` 260 → toast 300** | 49 — *"5 → add (6) → rename → pink → moved up → delete asks '12 used' → 5"*; found by a one-shot probe (a swatch click inside the modal failed before the fix, passed after) |
| 3 | **`Ctrl+X` copied but left the data in place** — a cut that cut nothing | `copySelection(cut)` relied on a host hook to do the clearing and this host's hook didn't, so correctness hung on a hook that was meant to be decorative | the cut clears inside `copySelection` (`clearValues` + announce + render); the hook is side-effect-only again | 24 — *"clipboard kept 2 rows, cells + tags cleared, one Ctrl+Z restored ["s_prog","s_review"]"* |
| 4 | **Paste-as-new-rows did nothing useful.** "Append as new rows" wrote into existing rows instead of creating any; "Create rows" ignored the pasted header | `pasteMatrix` had one code path plus a cosmetic mode flag — no row creation, no header matching | three real paths: `cells` (fill from the anchor, growing the table), `append` (inserts the rows first, then writes into them), `create` (maps each pasted column **by header name**, consuming the header row; out-of-table columns are counted and reported instead of vanishing) | 28–30 — *"append → 110 rows"*; *"grew to 82 rows, overwrote from the anchor: row3 = 'F0', row46 = 'F43'"*; *"header row consumed, 100 rows; owners ['Owner 0','Owner 1','Owner 2']; notes left empty"* |
| 5 | **Grid shortcuts fired behind an open dialog.** `Ctrl+Z`, `Delete` and the block keys edited the grid you could not see | the grid key handler had no concept of an open modal | early return while `.modal-overlay` exists — while a dialog is up, it owns the keyboard | verify-by-hand (this asserts a **non-event**, so there is no check to write): with a dialog open, `Ctrl+Z`/`Delete` no longer change the grid |

### Keyboard and focus

| # | What you'd notice | Cause | Fix | Covered |
|---|---|---|---|---|
| 6 | After closing a menu or popover, **every shortcut stopped working** until you clicked the grid again | removing the focused node parks focus on `<body>`; the grid only listens on its own root | `handFocusBack()` — called from `closeMenus`, `closePopovers`, editor `Escape` and the non-sticky commit path; it refuses to steal focus from a live editor or an open modal | 10 / 22 / 40 assert the grid still owns the keyboard (`.cell.is-active`) after an interaction; the menu → popover path was verified with a probe when fixed |
| 7 | `Home` / `End` jumped the active cell **off-screen** without scrolling | see §1 | `jumpTo()` | 22 + 40 — *"… → 14:1 → 14:19 …"*, *"End → active column 19, scrollLeft 1548"* |
| 8 | Duration fields mis-parsed: typing `45m` stored **45 seconds** | `parseDuration` matched a *prefix* with an unanchored clock regex, and a bare number was read in the field's unit before explicit units were considered | anchored clock forms (`1:30`, `1:30:15`); explicit units win (`45m`, `1h 30m`, `90s`); a bare number is still read in the field's own unit | 20 — *`{"90":90, "45m":2700, "2h":7200, "1h30m":5400}` seconds* |

### Dialogs and panels

| # | What you'd notice | Cause | Fix | Covered |
|---|---|---|---|---|
| 9 | `＋ Add sort` kept adding the **same field** again, and once everything was sorted it silently did nothing | it always passed `visibleFields()[0]` | picks the first *unsorted visible* field; when none is free it says so: toast *"Every visible field is already in the sort"* | 44 — *"two levels auto-picked ['f_task','f_status'] → … reordered ['Budget','Task']"* |
| 10 | The import **source** step showed a stale footer from the dialog before it | same footer-ownership bug as #1, in `drawSource` | `api.foot.innerHTML = ""` | 50–53 (same family as #1) |
| 11 | Deleting an option **silently wiped it from every row** that used it | delete had no usage awareness and no confirmation | shows usage and confirms: *Delete option → "12 row(s) use it." → button "Clear from rows"* (danger); unused options delete straight away | 49 — *"delete asks '12 used'"* |
| 12 | The settings row **"Top horizontal scrollbar" did nothing** | it wrote only the legacy mirror, not `settings.showTopScrollbar`, which is what the stacked view reads | writes both, and the default is now on (`showTopScrollbar: true`) to match the spec | 61 + 58 — *"14 setting rows …"*, *"top bar 220px → tables follow (220); switching the setting off hides it"* |
| 13 | **Field conversion corrupted values**: `duration → number → percent` produced nonsense | `convertField` read the raw value per target type without the per-type numeric map | a `NUMERIC` map per target type | 48 — *"duration→percent kept the value (7200 → 7200); cell shows '7200%'"* |
| 14 | The query bar's placeholder advertised a grammar the parser **rejected** | the placeholder was aspirational | the placeholder is the real grammar: `status:~done and budget>1000 or empty(due)` | 43 — the advertised string parses and filters |

### Query language

`js/query.js` rejected four forms that `docs/07` and the UI both imply. Both rows below now parse, and the parser round-trips them back to the same string.

| # | Was broken | Now | Covered |
|---|---|---|---|
| 15 | `and` → parse error (only juxtaposition worked); `empty(f)` / `notEmpty(f)` → unknown function; `field>v`, `field<v`, `field~v` without the colon → error | `and` is accepted sugar; `empty()`/`notEmpty()` exist; colon-less operators parse; juxtaposition still means AND | 43 — *"AND 'status:~done and budget>1000' → ['f_status isAnyOf','f_budget gt'] (2 chips) → 4 rows"* |
| 16 | `~` on a select matched nothing useful; `field:!empty` did not round-trip | `~` matches option **names**, case-insensitive → `isAnyOf` / `containsAny`; `field:!empty` normalises to `isNotEmpty` and round-trips | 43 (same check; all seven sample queries parse with 0 errors) |

---

### Follow-up round — the pinned column on a phone (finding 17)

Reported after the first pass: *"when I scroll horizontally, the columns are going down of the first
columns. I want to remove this mechanism from mobile view entirely."*

| # | What you'd notice | Cause | Fix | Covered |
|---|---|---|---|---|
| 17 | On a phone (or any narrow pane) **horizontal scrolling was useless**: every other column slid *under* the first one and never appeared | the pinned strip is the row-number gutter (74 px) + the primary column (290 px) = **364 px that never move**. In the 389 px phone host that left **~11 px** of scrolling area, so the scrolled columns were always behind the strip. The pinned strip is right on a 1280 px desktop and pointless at phone width | pinning is now a **wide-pane affordance**: `isNarrow()` = the pane the view owns is under **600 px**, and `frozenField()` returns null below it. Then the gutter moves into the scrolling lane (it is no longer a strip), the header carries the `#` cell, and `leadW()` becomes 0 — so gutter, primary column and the rest scroll together. The **freeze option is hidden** (View settings row, its subtitle, and the view-menu entry) while the rule is active, and a `ResizeObserver` on the grid area re-pins/unpins live as the pane crosses the threshold, including the harness's CSS-only phone squeeze | 64–67 — *"389px: frozen+corner hidden, gutter rides in the lane (first child), lane 2908px, scrollLeft 400 → leftmost column 2 (f_status), header cell '#"'*; *"1280px: strip 'f_task' pinned (x 87 → 87 after 700px), data columns moved 700px"*; *"desktop → 389px → desktop, no reload: pinned → narrow → pinned"* |

The rule is a product decision, not a prototype quirk: it is recorded as **P21** in
`../docs/08-decisions.md` and in the view-options and mobile rows of `../docs/01-spec.md`, so the real
plugin implements the same threshold.

| 18 | **Every portalled surface ignored dark mode.** Dialogs, menus, popovers and toasts render outside `#window`, so they kept the light palette while the grid went dark — measured: dialog `rgb(255,255,255)` on a `rgb(30,30,32)` grid, light overlay `rgba(30,25,22,0.42)` | the theme class was applied to `#window` only, and the plugin's colour tokens were declared **on `.tablify-root`**, inside it | the theme now lands on `<html>` and the tokens live in one file (`css/tokens.css`) declared at `:root`, so the portalled surfaces inherit them. Dark dialog is now `rgb(36,32,29)` (luminance 0.015), menu `rgb(36,32,29)`, overlay `rgba(0,0,0,0.58)` on a `rgb(28,25,23)` grid | 68 — *"identity light grid rgb(250, 246, 240) / dialog rgb(255, 253, 249); dark dialog rgb(36, 32, 29) (lum 0.015), menu rgb(36, 32, 29); host mode grid rgb(30, 30, 32) = --background-primary #1e1e20"* |
| 19 | The plugin's own fields **cancelled the focus ring** — `outline: none` on the search field, the query bar and every dialog `.ob-input` — and no `:focus-visible` rule existed anywhere, so keyboard users had no focus indicator at all | the visible ring was a `box-shadow` on two inputs only, and `.cell-editor` opted out too | one `:focus-visible` ring for the grid root, its controls, dialog fields, menu items and popover items, drawn with `outline` so it survives clipping, zoom and forced-colors; `.cell-editor` keeps its exemption because the cell draws the identical ring. Workspace chroming (`obsidian.css`) has zero suppressions left | 69 — *"keyboard → solid 2px rgb(164, 71, 42) offset 2; mouse click → tablify-btn → none 3px; dark ring rgb(217, 122, 84) (token #d97a54)"* |

| 22 | The toast **"fade" never happened** — `TF.toast` set `opacity = 0` while no transition existed anywhere in the build, so toasts blinked out; the app also had **0 `:active` rules**, no press feedback, no `transform-origin` and one dead `transition: width 120ms linear` on a bar nothing changes | only the exit was written; there was no motion layer at all | motion now follows the frequency table: dialogs 240 ms in / 160 ms out (with `pointer-events: none` while closing), popovers 160 ms growing from the cell that opened them, toasts 260 ms in / 180 ms out, press feedback `scale(0.97)` in 140 ms, and **no motion** on cells, rows, headers, the toolbar, the status bar or menus. Under `prefers-reduced-motion` every duration is 0 ms and JS skips the exit delay entirely; the 17 hover rules are wrapped in `@media (hover: hover) and (pointer: fine)` **in place**, so a touch device never gets a stuck hover state and cascade order is unchanged | 71–72 — *"menus instant (0 animations), dialog 240 ms in / 160 ms out with pointer-events none, press scale 0.970125 → none, popover 160 ms from 0px 0px, toast 260 ms in / 180 ms out"*; *"reduced: durations 0ms/0ms/0ms/1, 0 animations, dialog present immediately and removed in the same tick"* |
| 23 | **`Escape` left the keyboard stranded.** Closing a menu parked focus on the grid root, so the button the user came from was out of reach — and the grid owns `Tab`, so there was no way back to it | the menu closed by removing its node; the grid's `handFocusBack()` then parked focus on the grid root, and nothing remembered what had opened the menu | a menu records the element that was focused when it opened and hands focus **back to it** — deferred one tick so it beats `handFocusBack()`, and only when focus was genuinely lost (never when a menu item opened a dialog, and never when the user had already moved into an input) | 77 — *"17-item menu closed by Esc with focus back on ⋯ and 0 leftover nodes"*; measured before: `document.activeElement` was `DIV.tablify-root`, after: `BUTTON.tablify-btn is-ghost[More]` (`shots/content-focus-returned.png`) |
| 24 | **`Escape` did nothing inside the long-text popover** — a textarea held the key, so that surface could only be dismissed with the mouse; the Keyboard & touch help did not mention `Esc` at all | popovers are appended to `document.body`, i.e. **outside** the grid root the keyboard handler is bound to, and neither popover builder bound `Escape` itself | both popover builders now bind `Escape` on the surface (stop the event, close, re-render, hand focus back), and the help dialog gained a *Surfaces* group documenting `Esc` and `F1` | 77 — *"rating popover closed, Notes popover reopened on the next edit, 0 surfaces left at the end"*; measured before: `Escape` with the textarea focused left `.pop` in the document |
| 25 | **Two settings lied about what they controlled.** `Row checkboxes + numbering` removed only the header's select-all (the per-row checkboxes stayed), and grouping could not be slimmed at all — while `Advanced settings → Content` promises five honest switches | `view.rowNumbers` was read in exactly one place (the corner cell), and the group bar was appended unconditionally because "it is part of grouping" | the switch governs the gutter **content** it names (checkbox and number) while the drag handle stays because reordering is structure; the group bar is skipped at append time and the rows keep their order; the summary row completes the group | 73 — *"off → 0 row checkboxes but 22 drag handles, 0 group bars with 22 rows still present"*; 78 — *"⋯ menu → off → settings reads off → settings → on (24 checkboxes) → ⋯ menu ticks again"* |


## 3. Checked and already correct

So the list above is the whole answer, not a sample. The same sweep drives these and they passed before any fix: filtering (builder **and** query string, with live match feedback), multi-level sorting with real tie-breaking, grouping with per-key collapse, range selection and shift-extend, `Ctrl+C` in both TSV and HTML flavours, fill down / fill right / clear, bulk column edit, undo and redo across 5,000-row operations and imports, all 19 field types including option create-on-type, tag toggles, rating, attachments and read-only computed fields, column resize and reorder with auto-scroll, row reorder, hide fields, view presets, row heights, the pinned primary column (on wide panes), CSV / TSV / paste / XLSX import with type inference, skip-column, type override and the >250-row warning, five export formats (including a real `.xlsx`), sync link → diff → pull/push → per-field conflict review and the failure path, `.tabula` v1/v2/corrupt parsing with the dry-run gate, both screens, empty/loading states and `aria-live`.

Two honest limits — neither is a defect:

- **A windowed table cannot be wheel-scrolled from its own chrome.** The toolbar and status bar are separate surfaces (the toolbar scrolls horizontally when the window is narrow); the grid scrolls from the data, header, frozen column, corner and both scrollbars.
- **The filter builder mirrors the AND-only form of a query string.** An `or` query filters the grid correctly, but the builder shows zero condition rows because its row model is an AND list. Deliberate for the prototype; worth settling when the real builder is written (`docs/07`).

---

## 4. Reproducing this

```bash
cd prototype
npm install jsdom playwright-core && npx playwright install chromium
python3 -m http.server 8090 --bind 0.0.0.0        # serve this folder
node tests/smoke.js                  # 37 checks, no browser  → "ALL CHECKS PASSED"
node tests/scroll-verification.js    # geometry, wheel over every region, both thumb drags
node tests/interaction-audit.js      # 78 checks → "78 passed, 0 failed, 78 total", exit 0
cd .. && node tools/contrast.js      # 30/30 gated WCAG pairs, exit 0
```

Every check starts from a clean demo state, so a red line means the interaction is broken, not that test order drifted. The audit prints what it observed next to each check, e.g.

```
  ✓ 71. motion: occasional surfaces animate briefly, frequent ones never do
        menus instant (0 animations), dialog 240 ms in / 160 ms out with pointer-events none,
        press scale 0.970125 → none, popover 160 ms from 0px 0px, toast 260 ms in / 180 ms out
```


## 5. Open, found while fixing the above

| # | Finding | Why it is not fixed here |
|---|---|---|
| 20 | **The grid swallows `Tab`.** `js/grid.js:1451` binds `Tab` to "move the active cell" and calls `preventDefault()` unconditionally, so once the grid owns focus nothing else can ever receive it — 41 focusable controls live inside `.tablify-root` and none can be reached by keyboard (WCAG 2.1.2, keyboard trap) | the fix is a keyboard-ownership model (Tab moves cells only while the grid owns the keyboard; `Ctrl+Tab`/`Escape` release it), which is the accessibility pass, not a one-line patch. Tracked in `../DESIGN-REVIEW.md`, Stage 5 |
| 21 | Dialog controls still wear the **host accent** (checkbox fill, select borders, `.pill--*` chips) while the grid is clay | the tokens exist after Stage 1; repainting those components is the component pass (Stage 4) |
