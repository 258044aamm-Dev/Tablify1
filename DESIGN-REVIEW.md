# Design review — Tablify prototype

The executed UI/UX + design-engineering pass, as Before/After/Why tables (the format the
design-engineering skill requires). `Before` values are the real values measured in the files before
each stage — not impressions. `After` values are what the code now contains.

Companion: `PLAN-ui-ux-pass.md` (the plan), `prototype/AUDIT-REPORT.md` (behavioural defects).

**Correction to the plan's premise:** the "one stray `!important`" turned out to be inside the file's
header comment (`· no !important ·`), not a declaration — the zero-`!important` gate was intact all
along. The gate check added in Stage 1 strips comments before searching, so it can never be fooled by
a comment again.

---

## 1. Motion — measured before Stage 2

| Before | After | Why |
| --- | --- | --- |
| `transition: width 120ms linear` — the only transition in ~500 lines of CSS, and it animates `width` (layout + paint) | Removed. All motion moved to `transform`/`opacity` via tokens (`--tablify-dur-*`, `--tablify-ease-*`) | Layout-triggering animation drops frames on a 5,000-row grid; the resize indicator was the only animated thing in the app |
| No press state anywhere (`:active` count: 0) | `transform: scale(0.97)` at 140 ms on buttons, chips, menu items, dialog buttons | The philosophy's "meaningful feedback": a press that produces no response reads as a dropped input |
| `.toast` had `opacity = 0` set in JS with no `transition` declared ⇒ the "fade" was an instant blink, then removal | `transition: opacity 180ms ease, transform 180ms ease` (+ enter from `translateY(100%)`) | The JS already waited 220 ms for an animation that never happened; exit now matches the intent |
| Modals appeared with no transition | Enter 240 ms `opacity` + `scale(0.98→1)`, center origin; exits stay instant | Occasional surface, so it may animate — and scaling from 0.98 with opacity is the "nothing appears from nothing" rule |
| Menus/popovers appeared instantly, `transform-origin` count: 0 | Enter 160 ms, exit 120 ms, `transform-origin` computed from the trigger point | Popovers must grow from what opened them; exit shorter than enter |
| No `prefers-reduced-motion` block | Durations are tokens, so the reduce block sets them to `0ms` and collapses entry transforms — no `!important` needed | Reduced motion is a real user constraint; expressing it as token overrides keeps the zero-`!important` gate |
| 17 plugin hover rules ungated (`.tablify-btn:hover`, `.grid-row:hover .cell`, `.menu-item:hover`, …) | Wrapped in `@media (hover: hover) and (pointer: fine)` | On touch, `:hover` fires on tap and sticks — false states on the exact platform that is first-class here |
| `.toast`, `.pop`, `.menu` could be triggered rapidly with no interruptibility story | Transitions (not keyframes) everywhere; nothing animates on keyboard-initiated or 100+/day actions | Keyframes restart from zero on interruption; the frequency table forbids animating frequent paths at all |

## 2. Focus and keyboard — measured before Stage 1

| Before | After | Why |
| --- | --- | --- |
| `outline: none` on `.tablify-search`, `.tablify-query`, `.cell-editor` with a replacement ring only on the search | One `:focus-visible` ring from `--tablify-focus-ring` on every focusable element inside `.tablify-root` and `.modal-overlay`; `outline: none` removed where no ring existed | Keyboard operability: today the caret can be invisible in the query bar and the cell editor |
| Focus indicated by `box-shadow` on `.tablify-search:focus` only | Ring is a real `outline` with `outline-offset`, so it survives on top of any background, in forced-colors, and at any zoom | A box-shadow ring can be clipped and is map-invisible in high-contrast mode |
| `.cell.is-active` used `inset 0 0 0 2px` (fine) but the dimension is a literal | Cell ring reads `--tablify-focus-ring` and `--tablify-focus-w` | One place to change the ring's weight |

## 3. Tokens and honesty — measured before Stage 1

| Before | After | Why |
| --- | --- | --- |
| Palette literals inline in `tablify.css` (`--tablify-focus-ring: #9c4a2f`, `#e0916d`, …) with no separation between identity, semantics and theme mapping | `css/tokens.css`: **identity → semantic → mapping** layers, with the mapping switched by `[data-tablify-theme="identity|host"]` | The bold look is the default and the host theme is one attribute away; a swap of real brand values stays a one-file edit |
| No motion, space, radius or elevation tokens | `--tablify-dur-*`, `--tablify-ease-*`, `--tablify-sp-*`, `--tablify-radius-*`, `--tablify-shadow-*`, `--tablify-enter-*` | Consistency: any component can only be as consistent as the token set it draws from |
| Contrast unverified (placeholder palette) | `tools/contrast.js` computes WCAG ratios for declared token pairs from the comments in `tokens.css` and fails under threshold, in both modes | "Accessibility" as a gate, not an intention |
| No `prefers-contrast` / forced-colors handling | `@media (prefers-contrast: more)` strengthens lines and text; forced-colors keeps the focus ring | Users who ask for more contrast should get it |

## 4. Typography and iconography — measured before Stage 3

| Before | After | Why |
| --- | --- | --- |
| Every type size a literal (`11px`, `12px`, `13px`, …); no ramp | Named scale (`--tablify-fs-xs…xl`) with role assignments (cell, header, title, display) | Consistency across 500 lines of component CSS |
| Numerals in the default face; columns of numbers never align (`.cell.is-number` only changed alignment, not figures) | `font-variant-numeric: tabular-nums` on every numeric role, plus the embedded display face for numerals | A ledger where the digits don't line up is a ledger you can't scan |
| Identity type: none — the host font everywhere (`--font-text`) | One open-licensed face for display roles (view title, dialog titles, section headings, stat numbers, numerals); body text stays the host font | The identity has to live in the type; a wall of note text still belongs to the user's theme |
| Emoji/unicode glyphs as icons (🔗 ▣ ⣿ ↑ ↓ ✕ ✓) rendering differently per platform | Inline SVG sprite on a 24 px grid, 1.5 px stroke, `currentColor` | Icons that change shape between machines are decoration pretending to be UI |
| No wordmark | `wordmark.svg` + `mark.svg` drawn from the grid's own corner motif, monochrome | An identity you own, with no resemblance to anyone else's marks |

## 5. Component surfaces — worklist before Stage 4

| Before | After | Why |
| --- | --- | --- |
| Toolbar: 12 buttons at equal weight, wrapping unpredictably at 389 px | 6 primary actions + one grouped `More`; 44 px targets on touch, 36 px with a pointer | Progressive disclosure + efficiency: the two actions used constantly shouldn't sit beside ten used monthly |
| Grid: host-grey surfaces, borders drawn per-component with inconsistent weights | Parchment surface, hairline `sand` rules, clay caret on the active cell, tabular numerals | The signature: a hairline-ruled ledger with one accent where the eye is |
| Dialogs: centered modal at every width | Bottom sheet at ≤600 px pane width, safe-area aware | Mobile-first: a centered dialog with a software keyboard up is a dead end |
| Buttons: `min-height: 36px` | ≥44 px in touch/narrow mode | Touch accuracy |
| Empty state: one line of text | Headline + one clear next action, still no motion | "Meaningful feedback" without animation on a frequent surface |
| Status bar save state: colour + word | Colour + icon + word | Never colour alone |
| Import wizard: a stack of choice buttons | A real step header (1 of 3) and a preview table with tabular numerals | The one place where numbers must be compared down a column |

## Stage 1 — executed (2026-10-05): one colour file, one focus ring, one honest gate

Stage 1 is in the working tree and verified by the audit (checks **68–70**, added in this stage),
by `tools/contrast.js`, and by the two pre-existing suites, which are unchanged and still green.

| Before | After | Why |
|---|---|---|
| Colour literals in two places — `--tablify-*` on `.tablify-root` (light) and `.theme-dark .tablify-root` (dark) — so anything outside the grid could not see them | One file with three layers: **identity** (parchment / ink / clay values) → **semantic** (`--tablify-surface`, `--tablify-text`, `--tablify-focus`, …) → **mapping** (`:root[data-tablify-theme="host"]` re-points the same names at Obsidian's variables). The old names are re-exported, so no component had to change | A palette that swaps in one place is the precondition for every later stage; "follow my theme" (D3) is now one attribute on `<html>`, not a forked stylesheet |
| Theme class applied to `#window` only, so in dark mode **every portalled surface stayed light**: measured dialog `rgb(255,255,255)` on a `rgb(30,30,32)` grid, overlay `rgba(30,25,22,0.42)` | The class lands on `<html>` too, and the tokens are declared at `:root`. Dark dialog is now `rgb(36,32,29)` (luminance 0.015), menu `rgb(36,32,29)`, overlay `rgba(0,0,0,0.58)`, grid `rgb(28,25,23)` | Portal hosts sit outside the simulated window by design — a real plugin renders its modals in the app's modal container. The theme must be scoped to a common ancestor, never to the view |
| No focus indicator on the plugin's own controls: `outline: none` on the search field, the query bar and every `.ob-input`; 0 `:focus-visible`, 0 `:active`; the ring existed only as a `box-shadow` on two inputs | One `:focus-visible` rule covers the grid root, its controls, dialog fields, menu items and popover items; drawn with `outline` (survives clipping, zoom and forced-colors), clay token, 2 px, offset 2 px. `.cell-editor` keeps a documented exemption — the cell around it already draws the identical ring | "Accessibility is not optional" was unenforceable while the stylesheet cancelled the browser's own ring. Measured: keyboard → `solid 2px rgb(164,71,42)`, dark → `rgb(217,122,84)`, mouse click → none |
| Contrast asserted in prose ("AA contrast") | `tools/contrast.js` reads the `@contrast` declarations in `tokens.css`, resolves `var()` aliases and exits non-zero on any gated pair: **26/26 pass** in light and dark (body 14.30:1 / 13.78:1, muted 5.47:1 / 7.35:1, text-on-clay 5.43:1 / 5.71:1). Decorative hairlines are declared `@contrast-info` (1.26:1 / 1.41:1) — reported, never gated | A palette without a gate drifts the first time someone tweaks a hex value. The gate strips comments before scanning, so a comment can never trip or satisfy it |
| Reduced motion, higher contrast and forced colours unhandled | `prefers-reduced-motion` zeroes every duration token and drops the enter-scale (movement goes, opacity stays); `prefers-contrast: more` firms up hairlines and secondary text; `forced-colors` gets a `Highlight` ring | Durations are tokens precisely so this is four lines instead of a rewrite — and it lands *before* any motion exists (Stage 2) |
| Menus, popovers, dialogs and toasts painted from host variables, so they followed Obsidian even in Tablify's own mode | Those plugin-owned surfaces now paint from the semantic tokens; the simulated **host** chrome (window, tabs, legacy screen) still uses host variables, because it is the host | "Bold identity by default, one switch to defer" only means something if the surfaces the plugin owns follow it |

**Verified after the change** (the suite has grown to 78 checks since — see the Stage 2 and settings-stage records): smoke `37/37` · audit **70 passed, 0 failed, 70 total** (91 s, 0 page
errors; checks 1–67 unchanged and green) · scroll verification unchanged · contrast gate 26/26.

**Found while executing — deliberately not fixed in Stage 1:**

- **The grid swallows `Tab`.** `js/grid.js:1451` binds `Tab` to "move the active cell" and calls
  `preventDefault()` unconditionally, so once the grid owns focus a keyboard user can never leave it
  (WCAG 2.1.2, keyboard trap). 41 focusable controls exist inside `.tablify-root` and none of them can
  be reached by Tab. This is a **Stage 5** item, because fixing it means specifying who owns the
  keyboard (Tab moves cells only while the grid is the owner; `Ctrl+Tab` and `Escape` must release it)
  rather than patching one key.
- **Dialog controls still wear the host accent** — the checkbox fill, select borders and `.pill--*`
  chips are host-variable-driven. The tokens now exist; repainting them is the **Stage 4** component
  pass. Visible in `prototype/shots/stage1-c-dark-dialog.png`.

## Stage 2 — executed (2026-10-05): motion, decided by frequency

The rule applied is the skill's frequency table, not taste: **cells, rows, headers, the toolbar and
the status bar are seen thousands of times a day and get no motion**; menus are opened dozens of times
an hour and stay instant; only *occasional* surfaces (dialogs, popovers, toasts) animate, and press
feedback is a 140 ms scale. Verified by audit checks **71–72** (71 runs in a `no-preference` context
and measures real `document.getAnimations()` entries; 72 runs in a `reduce` context).

| Before | After | Why |
|---|---|---|
| The toast "fade" was a lie: JS set `opacity = 0` while **no transition existed**, so toasts blinked out after 2.2 s | `.toast` enters in **260 ms** (`opacity` + `translateY(8px)`) and leaves in **180 ms** via an `is-leaving` class; removal still happens at the same moment, so nothing lingers | Asymmetric on purpose: slow where the user is reading, fast where the system is responding. The measured exit mid-flight is what proves it is not a blink |
| Every dialog appeared and vanished instantly, and its overlay stayed clickable while disappearing | `.modal-overlay` fades in **240 ms**, the centred dialog does `opacity + scale(0.98) + translateY(4px)`; closing adds `is-closing` → **160 ms** out with `pointer-events: none`, then removal | A modal stays centred, so no directional slide (documented exemption in the skill). `pointer-events: none` means the exit never blocks the next click — the reason the exit can exist at all without slowing the app down |
| Popovers snapped into place; `transform-origin` appeared nowhere in the build | `.pop` enters in **160 ms** and grows from the cell that opened it — `originFrom()` computes the origin from the anchor rect, and flips to `100%` when the popover opens upward | "Popovers must feel like they came from their trigger"; the origin is computed from geometry, not hard-coded, so it survives clamping at the viewport edge |
| 23 `:hover` rules, **0 `:active`**, no press feedback anywhere; menu items and buttons felt like flat images | Press feedback on every plugin control: `scale(0.97)` over **140 ms** `ease-out` (`--tablify-dur-press`), plus colour easing at 120 ms for hover; measured `matrix(0.970125, …)` under a real mousedown | A press needs an answer within ~100 ms; nothing about it animates layout, so it is free even under load |
| Menus were candidates for the same treatment | **Deliberately not animated** — measured 0 animations on open | Opened dozens of times an hour: any delay here reads as lag, which is exactly what the frequency table forbids |
| The only transition in the build was `transition: width 120ms linear` on a skeleton bar nothing ever changes | Removed; the file now animates `opacity`/`transform` only | Animating a layout property on a per-frame surface is the one thing the perf rules rule out — and in this case it was animating nothing at all |
| `prefers-reduced-motion` existed as tokens but was never exercised | Under `reduce`: every duration token is `0ms`, the enter-scale is `1`, no animation runs, and **JS skips the exit delay entirely** — the dialog is present on the click and removed in the same tick as `Escape`; the toast exits with no animation | Reduced motion must be fewer-and-gentler, not "everything still moves, but shorter" — and it must never make the UI *slower* than the animated path |
| All 17 hover rules were unconditional, so on a touch device the first tap left a **stuck hover state** on a cell, header or menu item | The same rules, wrapped **in place** in `@media (hover: hover) and (pointer: fine)` — never hoisted — so cascade order is byte-for-byte what it was, and a device reporting `hover: none` simply never gets the state | Hover is a pointer affordance. Wrapping in place (rather than collecting them into one block at the end) is what keeps `.pop-item:hover` from starting to out-rank `.pop-item.is-picked` |
| Closing a dialog left `document.querySelector('.modal-overlay')` as a guard in two places, which would now stay true during the 160 ms exit | Both guards read `.modal-overlay:not(.is-closing)`, and `modal()` evicts any closing overlay before opening the next one | The exit animation must be invisible to the rest of the app: no focus hand-back blocked, no grid shortcut muted, and never two dialogs in the document |

**Verified after the change:** smoke `37/37` · audit **72 passed, 0 failed, 72 total** at the time (118 s, 0 page
errors; checks 1–70 unchanged and green — the suite has since grown to 78, see the settings-stage record) · scroll verification unchanged ·
measured: menus 0 animations, dialog 240 ms in / 160 ms out (`pointer-events: none` while closing),
press `matrix(0.970126, …) → none`, popover 160 ms from `0px 0px`, toast 260 ms in / 180 ms out,
`.cell`/`.grid-row`/`.hcell`/`.tablify-toolbar`/`.tablify-statusbar` `transition-duration: 0s`,
17/17 hover rules gated (grep-verified), contrast gate 26/26.

**Not motion, and deliberately so:** drags (column resize, reorder, fill handle, scroll thumbs) are
direct manipulation and get no added animation; the empty/loading states stay static.

## Settings stage — executed (2026-10-05): "Advanced settings → Content", every switch on by default

Asked for: `Settings > Advanced settings`, a `Content` group, all of it enabled by default — under the
standing rule that the stage may not disturb anything that already worked. The three clarifying
questions came back skipped, so the reading recorded in `PROCEED-ASSUMPTION-2026-10-05.md` was
executed: the group belongs in the prototype's own **Settings** tab, and "content" means the *view's own*
content — the things a view shows that are not the data itself. It ran between Stage 2 and Stage 3.

| Before | After | Why |
| --- | --- | --- |
| Settings had six sections and **no way to hide the view's own furniture**: the toolbar and the status bar were permanent, and the row gutters could only be switched *partly* (the `⋯` menu had row checkboxes, nothing else) | A new **Advanced settings** section whose **Content** subgroup holds five switches — **Toolbar, Status bar, Row numbers & checkboxes, Group headers, Summary row** — all **on by default**, each one hiding real content through the single `layoutChrome()` path | The ask. Default-on is what keeps every existing screen identical until someone deliberately narrows it; and a switch that only *looks* like a switch is worse than no switch at all, so each one had to be wired to something measurable |
| `view.rowNumbers` existed but only removed the header's check-all: the per-row checkboxes stayed put, so the setting quietly disagreed with its own menu label | The switch now governs the gutter content it names — checkbox **and** row number — while the drag handle **stays**, because reordering is structure, not content | A control must govern the thing its label names. The audit measures both halves: 0 row checkboxes *and* 22 surviving drag handles with the switch off (check 73) |
| Grouping always drew a bar per group with no way to slim it down | The group bar is content too: switched off, the rows of the group are still there, in order, just unlabelled | Same distinction as the gutter — structure stays, content goes. "Hide the header" must never mean "hide the rows" |
| There was no summary row at all | A real **28 px summary row** under the grid, built in the same two-lane geometry as the rows (frozen part + a lane the scroll handler translates), showing counts, `Σ` sums and `⌀` averages computed **from the rows this view is actually showing** | The Content group needed content to control, and the real plugin will read the `summaries` block of the `.base`. Computing from the visible rows means the row cannot lie about what it is summarising — and check 74 recomputes every figure from the store and compares |
| Two facts claimed one switch: `settings.rowNumbers` and `view.rowNumbers` | One control writes both. The `⋯` menu item and the Advanced settings row are **the same switch**, in both directions | One owner per fact. Check 78 drives it menu → settings → menu and reads the grid between each step |
| `Escape` closed a menu and **parked focus on the grid root**, so the trigger the keyboard user came from was gone (and the grid owns `Tab`) | A menu hands focus back to whatever opened it — deferred one tick so it wins over the grid's own `handFocusBack()` — and guarded so it never steals focus from a dialog that just opened or an input the user moved into | Measured before: after `Escape` on the `⋯` menu, `document.activeElement` was `.tablify-root`; after, it is the `⋯` button (screenshot `content-focus-returned.png`) |
| `Escape` **did nothing inside the long-text popover**: the textarea owned the key, so that surface was mouse-only to dismiss | Every popover binds its own `Escape` (they are appended to `document.body`, outside the root-scoped key handler), and the Keyboard & touch help now documents `Esc` and `F1` | A surface you can open with the keyboard has to close with the keyboard. Measured before: `Escape` with the textarea focused left `.pop` in the document |
| A saved snapshot from an older build could not know about the five new keys — every missing switch would have read as *off* | `load()` merges `initialState().settings` **under** the saved snapshot, so a new setting's default is whatever the code says, never `undefined` | The plugin will spend years reading `.base` sidecars and localStorage written by older versions; a default has to be applied where the snapshot is read, not where it is written |
| Contrast gate: 26 gated pairs | **30** — the summary row's two new surfaces are declared in `tokens.css`: `--tablify-text-muted` and `--tablify-number` on `--tablify-surface-sunken` (5.02 / 6.28 light, 7.71 / 9.65 dark) | A new surface does not get to skip the gate |
| Audit: 72 checks | **78** — two for the Content group (73–74) and four that were specified but never landed on disk: save + reload parity (75), reset-to-sample + reload (76), `Escape` on the top surface only (77), and `⋯` ↔ Settings parity (78) | Every fix ships with a test. Checks 75 and 76 do a **real** `page.reload()`, which is the only way to prove persistence rather than re-reading the same object |

**Verified after the change:** smoke **37/37**, 0 runtime messages · audit **78 passed, 0 failed, 78 total**
(124 s) with **page errors and console errors during the run: none** · scroll verification clean
(`scrollTop 300 / scrollLeft 240`, thumbs 378/667, drag-select auto-scroll, 0 page errors) · contrast
**30/30** · `node --check` clean on every edited file.

**What the switches do not do:** they never remove an element from the layout. Hiding the toolbar or the
status bar sets `display: none` on a *flex sibling* of the grid area, and the grid answers with
`clientHeight`, so the measurement is simply correct; the group bar is skipped at append time and the
row keeps its position. Nothing is absolutely positioned against a chrome element, which is why the
30-row, 5,000-row and 389 px checks all still pass untouched.

**Left alone on purpose (queued, not forgotten):** the Content subgroup label is styled identically to the
existing section labels, so the two levels look alike until Stage 4 gives the settings screen a
hierarchy; percent columns sum where an average would often be the better default (the real plugin takes
these from the `.base` `summaries` block, so the decision belongs there); the grid still owns `Tab`
unconditionally, which is Stage 5's job. All three are in `PLAN-style-audit-notes`.
