# Prototype tests

Three harnesses, all run outside the page (nothing ships to the browser).

| file | what it proves | how to run |
| --- | --- | --- |
| `smoke.js` | 37 checks: data model, CSV/XLSX, sync diff, `.tabula` parse + migration, grid keyboard, every dialog opens, 5,000-row windowing, persistence — in jsdom, no browser | `npm install jsdom` then `node tests/smoke.js` |
| `interaction-audit.js` | 78 checks in real Chromium: every menu, every editor, blocks (copy/cut/paste/fill/undo), all three paste modes, drags, wheel + thumbs, all 18 dialog surfaces, import wizard (text, file, append/replace/create, >250-row warning, skip + type override), export files, sync pull/conflict/failure, `.tabula` gate + migration, settings, 389 px + touch, the narrow-pane unpinning rule (checks 64–67), 5,000 rows, and the design-token gates (68: identity palette + dark reaching the portalled surfaces + the host-theme switch; 69: one keyboard-only focus ring in light and dark; 70: one file owns every colour, zero `!important`, every `var()` resolves; 71: motion by frequency — dialogs/popovers/toasts animate, menus and every per-frame surface do not; 72: `prefers-reduced-motion` removes the movement *and* the exit delay; 73–74: the `Advanced settings → Content` switches all start on and each one really hides its content — including the summary row, whose counts/sums/averages are recomputed from the store and compared; 75–78: persistence proven with a real `page.reload()` (view state survives, reset-to-sample survives), `Escape` closing the top surface only with focus returned, and the `⋯` menu ↔ Settings parity of the row-numbers switch) | see below |
| `scroll-verification.js` | geometry and scrolling: header/row gap, wheel over rows/header/frozen/corner/bars, thumb drags, drag-select auto-scroll | same as the audit |

```bash
# one-time
npm install playwright-core
npx playwright install chromium --with-deps

# serve the prototype, then run the browser suites
python3 -m http.server 8090 --bind 0.0.0.0
node tests/scroll-verification.js
node tests/interaction-audit.js          # exit code 0 = all 78 passed
TABLIFY_URL=http://127.0.0.1:9000/index.html node tests/interaction-audit.js
```

Every check starts from a clean demo state (`localStorage.clear()` + reload), so a
failure can only mean the interaction itself is broken — not test ordering.
The audit prints one line per check with what it actually observed, then a
headline, e.g.

```
  ✓ 68. theme: the identity palette is the default, dark reaches the portalled surfaces
        identity light grid rgb(250, 246, 240) / dialog rgb(255, 253, 249); dark dialog rgb(36, 32, 29)
        (lum 0.015), menu rgb(36, 32, 29); host mode grid rgb(30, 30, 32) = --background-primary #1e1e20
  ✓ 69. focus: one clay ring for the keyboard, nothing on a mouse click
        keyboard → solid 2px rgb(164, 71, 42) offset 2; mouse click → none; dark ring rgb(217, 122, 84)
  ✓ 71. motion: occasional surfaces animate briefly, frequent ones never do
        menus instant (0 animations), dialog 240 ms in / 160 ms out with pointer-events none, press scale
        0.970125 → none, popover 160 ms from 0px 0px, toast 260 ms in / 180 ms out,
        cells+rows+header+toolbar+statusbar 0s
  ✓ 72. motion: reduced motion removes movement and never delays the UI
        reduced: durations 0ms/0ms/0ms/1, 0 animations, dialog present immediately and removed in
        the same tick, toast removed with no exit

  ✓ 73. content: every switch under Advanced → Content starts on, and really hides content
        Content: 5 switches on by default; off → toolbar/status/summary hidden, 0 group bars with 22
        rows still present, 0 row checkboxes but 22 drag handles; on → 19 summary cells, 4 group bars, …
  ✓ 77. keyboard: Escape closes the top surface only, leaves no nodes and no stuck grid
        17-item menu closed by Esc with focus back on ⋯ and 0 leftover nodes; rating popover closed,
        Notes popover reopened on the next edit, 0 surfaces left at the end

  78 passed, 0 failed, 78 total
  page errors / console errors during the run: none
```

A failing check prints the same line with `✗` plus what it expected, so a run
log is readable without re-running anything.
