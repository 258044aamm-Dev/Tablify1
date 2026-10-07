# Tablify prototype

> **Historical prototype / not target authority:** this self-contained browser model reflects the earlier Bases/note/`.tabula` product direction. Keep it as an audit artifact only; it is not evidence that native `.tablify` behavior exists. Use the current product decisions and R0–R6 guides for the refactor. Do not extend the prototype as part of plan-only work.

A **working, self-contained model** of the plugin specified in `../docs/`. No build step, no
network calls, no dependencies: open `index.html` in a browser (or serve the folder) and drive it.

It exists to answer the question the spec can only answer on paper: *does this feel right, and does
the logic actually work?* Filters filter, sorts stack, undo restores, CSV parsing is real, the
`.xlsx` writer produces a file Excel opens, and the sync engine does a genuine three-way diff.

```
prototype/
├─ index.html            the simulated Obsidian window + harness + script order
├─ css/
│  ├─ tokens.css         the plugin's design tokens: identity → semantic → mapping, plus the
│  │                     "follow my Obsidian theme" switch, motion/spacing scales and the
│  │                     focus ring (the only file that may declare a colour)
│  ├─ obsidian.css       the host chrome (window, tabs, modals, toasts, legacy + settings views)
│  └─ tablify.css        the plugin's own components (no !important, ≤2-level selectors)
└─ js/                   one namespace (window.TF), loaded in this order:
   ├─ data.js            19 field types, formatters, 30×20 demo table, legacy + sync + import fixtures
   ├─ query.js           operator table, comparators, AST, query-string parser, view pipeline, grouping
   ├─ io.js              CSV/TSV/HTML-table parsing, type inference, real .xlsx writer, clipboard, download
   ├─ store.js           the single mutation path: commit() → one undo step, selection, persistence
   ├─ sync.js            three-way diff (snapshot vs local vs remote), fake transport, resolution rules
   ├─ grid.js            windowing, range selection, keyboard, clipboard, per-type editors, drags
   ├─ dialogs.js         menus, modal shell, and every dialog surface
   ├─ legacy.js          .tabula parser (v1/v2/corrupt), stacked-table view, dry-run migration
   ├─ settings.js        the settings tab
   └─ harness.js         the simulated host: screens, theme/host toggles, surface dispatcher, demo data
shots/                    proof: the narrow-pane rule (389 px, nothing pinned), the Stage 1
                          theme/focus work (light dialog, dark dialog, host-theme mode, narrow dark)
                          and the settings stage (the Content group, the summary row in light and
                          dark, the keyboard ring back on the ⋯ trigger after Escape)
tests/                    the harnesses that verify it (see tests/README.md)
├─ smoke.js              37 checks in jsdom — no browser needed
├─ interaction-audit.js  78 checks in real Chromium — every menu, editor, dialog and block
│                       operation, plus the theme/focus/token gates (68–70) and the motion
│                       gates (71–72, measured with document.getAnimations()), the
│                       Advanced-settings Content group (73–74: each switch hides real content)
│                       and persistence/reset/Escape/parity (75–78, each proven across a reload)
└─ scroll-verification.js geometry and scrolling, measured rather than eyeballed
```

## What is genuinely implemented

| Area | Working behaviour |
|---|---|
| Filtering | condition builder (AND/OR), type-aware operators, option chips, live `is-match` feedback |
| Query string | `field:value`, `>100`, `!x`, `a,b`, `empty`, quoted names; whitespace is AND, `or` is OR; errors reported |
| Sorting | multi-level, ordered, real tie-breaking |
| Grouping | group bars, collapse state per key, groups follow the sort |
| Selection & blocks | range select, shift-extend, copy/cut/paste (TSV+HTML), fill down/right, clear, bulk column edit |
| Undo/redo | every mutation is one step, including 5,000-row operations and imports |
| Editing | editors for all 19 types, incl. option pickers with create-on-type and read-only computed fields |
| Structure | add/duplicate/delete/convert fields, resize, reorder, hide, option manager with usage counts |
| Import | CSV/TSV/paste/XLSX (+ODS where the browser can decode), type inference, preview, skip columns, replace/append/create, >250-row warning |
| Export | CSV, TSV, Markdown, JSON, and a real `.xlsx` (stored-entry ZIP written in the browser) |
| Sync | link → diff → pull/push → conflict review, per-field, never silent; failure path simulated |
| Summary | a real summary row under the grid — counts, `Σ` sums and `⌀` averages computed from the rows the view is showing, in the same lane geometry as the rows so it stays under its columns |
| Settings | Rows & files, Import & export, Sync, Appearance, Legacy presentation, Data — plus **Advanced settings → Content**: toolbar, status bar, row numbers & checkboxes, group headers and the summary row, every switch **on by default** and each one really hiding its content |
| `.tabula` | v1/v2/corrupt parsing, stacked tables with the wide top scrollbar, dry-run report, one-way migration |
| View | row heights, frozen primary column (**wide panes only** — under 600 px nothing is pinned), row numbers, presets, hidden fields |
| States | empty table, empty result, loading skeletons, save indicator, toasts, `aria-live` announcements |
| Responsive | light/dark, desktop/389 px host squeeze, touch targets, 5,000 rows windowed at ~190 mounted cells |

## Deliberately not here

Kanban, cards, list, map and CSV-as-a-view-type: Bases already ships those (`../docs/08-decisions.md`,
E-series). This prototype is the grid plus every surface that has to exist on its own.

Data lives in `localStorage` (key `tablify.prototype.v3`) so edits survive a reload. **No token is
ever stored** — the settings tab records only that one was set.

## Driving it

- The dark bar at the top is the **harness**, not the plugin: screen switching, light/dark, the
  389 px phone squeeze, a dispatcher for every dialog surface, and demo data (−/+/5,000 rows,
  sync drift, reset). The phone squeeze is also how you see the **narrow-pane rule**: below
  600 px of pane width nothing is pinned, so the gutter and the first column scroll with the
  rest and the freeze option disappears from View settings.
- Global keys: `1/2/3` screens, `F1` or `?` keyboard help, `Ctrl+Z`/`Ctrl+Y` undo/redo, `Ctrl+F` filter.
- Grid keys while focused: arrows, `Shift+arrows`, `Tab`, `PageUp/Down`, `Enter`/`F2` to edit,
  `Ctrl+C/X/V`, `Ctrl+D` fill down, `Ctrl+R` fill right, `Ctrl+A`, `Delete`, `Space` on checkboxes.
- Touch: long-press a cell, a header or a row handle for the same menus.

## How it was verified

Three harnesses, all reproducible from a clean state — every check clears `localStorage` and
reloads first, so a failure can only mean the interaction is broken:

| harness | result |
|---|---|
| `tests/smoke.js` (jsdom, no browser) | **37/37** — data model, CSV/XLSX in and out, the three-way sync diff, `.tabula` fixtures, grid keyboard, every dialog open/close, 5,000-row windowing, persistence |
| `tests/interaction-audit.js` (real Chromium) | **78 passed, 0 failed**, 124 s, 0 page/runtime errors — every menu, every editor, blocks (copy/cut/paste/fill/undo), all three paste modes, drags, wheel + both thumbs, 18 dialog surfaces, the import wizard, exports, sync pull/conflict/failure, `.tabula` gate, settings, 389 px + touch, 5,000 rows, the narrow-pane rule (nothing pinned, freeze option hidden, live re-pinning when the pane crosses 600 px), and the design gates: identity palette + dark reaching the portalled surfaces, one keyboard-only focus ring, one file owning every colour with no `!important`, motion by frequency (dialogs 240/160 ms, popovers 160 ms from their trigger, toasts 260/180 ms, menus and every per-frame surface at 0 s) reduced-motion behaving the same but instantly, and all 17 hover rules gated to real pointers |
| `tests/scroll-verification.js` | header/row gap **0 px**, scroller extent 2922×1298 with a matching spacer, wheel from all four regions, both thumb drags, drag-select auto-scroll |

| `../tools/contrast.js` (no dependencies) | **30/30 gated pairs pass**, exit 0 — the WCAG ratios are computed from `tokens.css` for light and dark, not eyeballed; comments are stripped first so a comment can never trip the gate |

`node --check` passes on all ten plugin files. The audit that produced this state, including the 16
interactions it found broken and how each was fixed, is written up in **`AUDIT-REPORT.md`**.
