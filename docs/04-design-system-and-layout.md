# 04 — Design system, layout contract and accessibility

## The two problems this document exists to kill

The previous build shipped 2,141 lines of CSS with **7 `!important` rules, 46 custom properties, only 12 references to Obsidian theme variables, and deep descendant chains** (`​.tabula-view .tabula-mount .tabula-file-root button.tabula-btn`). The result was a plugin that painted over the user's theme and had to be re-patched for every theme, plus a height chain that consumed 15 commits.

Two rules replace it:

1. **Structure and surfaces come from Obsidian's variables.** The plugin adds brand *accent*, not its own chrome.
2. **The grid fills the container it is given.** It never negotiates height with its ancestors.

## Token tiers

```
tier 1 — Obsidian theme variables     (read-only: never redefine them)
tier 2 — brand.css                    (our accent/selection/status tokens)
tier 3 — grid.css / editors.css       (components; may only use tier 1 and 2 tokens)
```

### Tier 1 — the mapping (structure & surfaces)

| Purpose | Variable |
|---|---|
| Grid background | `--background-primary` |
| Header background | `--background-secondary` |
| Hover row | `--background-modifier-hover` |
| Selected row wash | `--background-modifier-active-hover` |
| Grid lines | `--background-modifier-border` |
| Primary text | `--text-normal` |
| Muted text (row numbers, placeholders) | `--text-muted` |
| Faint text | `--text-faint` |
| Primary action button | `--interactive-accent` / `--text-on-accent` |
| Focus outline | `--background-modifier-border-focus` |
| Radius | `--radius-s` / `--radius-m` |
| Font sizes | `--font-ui-smaller` / `--font-ui-small` / `--font-ui-medium` |
| Monospace (numbers, ids) | `--font-monospace` |

If a surface has no theme variable, the answer is *do not style it*, not *pick a hex*.

### Tier 2 — brand tokens (`brand.css`)

Placeholders below are deliberately **not** any third party's published brand values. Replace the values in one file; nothing else changes.

```css
.tablify-root {
  /* light */
  --tablify-accent:         #9c4a2f;   /* primary brand, buttons, active state */
  --tablify-accent-hover:   #833c26;
  --tablify-accent-subtle:  #f6e9e2;   /* selection wash, tag backgrounds */
  --tablify-accent-text:    #ffffff;   /* text on accent — verify AA */
  --tablify-focus-ring:     #9c4a2f;
  --tablify-selection-line: #9c4a2f;   /* range border */
  --tablify-ink:            #2a2521;   /* high-emphasis text on brand surfaces */
  --tablify-number:         #6b4a3a;   /* numeric cells, tabs on figures */
}

.theme-dark .tablify-root {
  --tablify-accent:         #e0916d;
  --tablify-accent-hover:   #eda583;
  --tablify-accent-subtle:  #3a2a22;
  --tablify-accent-text:    #221a16;
  --tablify-focus-ring:     #e0916d;
  --tablify-selection-line: #e0916d;
  --tablify-ink:            #f2ece7;
  --tablify-number:         #d7b7a4;
}
```

Rules for tier 2:

- **Accent is reserved for selection, focus and primary actions. It is never a status colour.** Select-option pills, ratings and checkboxes use the nine option colours and theme variables, so brand and semantics never collide.
- Every text/background pair must pass **WCAG AA (4.5:1 for body text, 3:1 for icons and boundaries)** in both light and dark. Verify before merging a palette change; record the check in the PR.
- `!important` is banned. If a rule loses, fix specificity by shortening the selector.

### Tier 2b — status/option colours

Nine option colours (`gray, blue, green, yellow, orange, red, pink, purple, cyan`) are defined as tinted pills derived from theme hues:

```css
.tablify-pill { background: color-mix(in srgb, var(--tablify-pill-hue) 18%, transparent);
                border-color: color-mix(in srgb, var(--tablify-pill-hue) 35%, transparent);
                color: var(--text-normal); }
```

`color-mix()` is used deliberately: it keeps pills legible in every theme without hardcoding a light/dark pair per colour, and it is supported on all Obsidian targets (desktop Electron, iOS/Android WebView) at the declared `minAppVersion`.

### ⚠️ Branding constraints (read before touching `brand.css`)

The palette direction is a warm clay/parchment family. It must be shipped as **your own tokens**:

- **Do not** name a colour token, class, comment, README section or settings copy after another company (Anthropic, Claude, Airtable, Notion). No "anthropic" in the repo, at all.
- **Do not** use any third party's logo, wordmark, icon, or a visual imitation of their marks.
- **Do not** imply affiliation or endorsement anywhere — README, listing description, settings text.
- Colour values themselves are not protected, but *trade dress imitation of another product's look and feel* is the thin edge here. The safe path is a palette that reads as warm and considered without being a reproduction, under your own names (`--tablify-accent`, `--tablify-clay`).

## The layout contract

**One contract, both hosts** (Bases view container and the legacy file view). Obsidian sizes the host; the plugin fills it and owns exactly one scroller below it.

```
host element (Obsidian-sized, position: relative)
  └─ .tablify-root            position: absolute; inset: 0;
     │                        (display:flex; flex-direction:column; overflow:hidden)
     ├─ .tablify-toolbar      flex: 0 0 auto
     ├─ .tablify-scroller     flex: 1 1 auto; overflow: auto; overscroll-behavior: contain
     │   ├─ .tablify-canvas      height = totalRows × rowHeight (the scroll range)
     │   ├─ .tablify-rows        transformed by -scrollTop, windowed
     │   ├─ .tablify-header      transformed by (-scrollTop, scrollLeft) — sticky layer
     │   └─ .tablify-frozen-col  transformed by (-scrollTop, 0) — frozen layer
     └─ .tablify-statusbar    flex: 0 0 auto   (optional: counts, write status)
```

Why `position: absolute; inset: 0`: an absolutely-positioned box takes its size from its container's *padding box* and cannot be collapsed by an intermediate flex/percentage chain. The old failure mode — Obsidian's mobile shell compressing `.app-container` from 860px to 389px when the keyboard opened while every percentage layer collapsed to 0 — is structurally impossible here.

**Forbidden:** percentage heights on any ancestor of the scroller, `height: 100%` chains, `ResizeObserver` writing height custom properties, `window.innerHeight` reads during layout, `100vh` (it ignores mobile browser chrome), and `requestSaveLayout()` in a typing path.

## Mobile

### Keyboard and viewport

- Listen to `window.visualViewport` (`resize` + `scroll`, passive, registered with `registerDomEvent` on the view) and drive **one** CSS variable: `--tablify-keyboard-inset`, applied as `padding-bottom` on `.tablify-root`. The document height is never renegotiated.
- Scroll the active cell into view *after* the inset settles (one `requestAnimationFrame`), so editing a cell near the bottom does not hide it under the keyboard.
- Safe areas: `env(safe-area-inset-*)` on the toolbar and statusbar, so the grid never sits under a notch or home indicator.
- **Inputs are ≥ 16px** (`--font-ui-medium` or an explicit 16px on editors) so iOS never zooms the viewport on focus. This is what produced the "input zoom" bug class previously.

### Touch

| Concern | Rule |
|---|---|
| Target size | ≥ 44×44 px for any tap target; row height minimum 40 (medium) on mobile |
| Context menus | Long-press (≈500 ms) with visual feedback before opening; also reachable from a toolbar button, since long-press is not discoverable |
| Hover-only affordances | Banned — resize handles, row handles and add-row affordances must be visible on touch |
| Range selection | Explicit toolbar toggle (a drag would fight scrolling), then drag sets the range |
| Scrolling | `-webkit-overflow-scrolling: touch`; momentum preserved; never capture vertical pan while a range drag is not active |
| Toolbar | Collapses to an overflow menu below 520 px width; the toolbar never wraps to two rows |

### Gestures that must not exist

Pinch-to-zoom inside the grid fails on mobile as often as it succeeds. Zoom is the OS/browser's job.

## Accessibility

| Area | Requirement |
|---|---|
| Semantics | `role="grid"`, `role="row"`, `role="gridcell"`/`role="columnheader"`, with `aria-rowcount`, `aria-colcount`, `aria-rowindex`, `aria-colindex` (indices count virtualized-but-absent cells) |
| Focus | Roving `tabindex`: the grid is one tab stop; arrows move focus; `aria-activedescendant` is **not** used, real focus moves |
| Read-only cells | `aria-readonly="true"` plus a title explaining why |
| Selection | `aria-selected` on cells in the range and on the active row |
| Bulk operations | Announce completion via a polite live region: "412 cells updated in 137 notes" |
| Conflicts / import dialogs | Real Obsidian `Modal` (focus trap, Escape, focus restore for free) |
| Reduced motion | All transitions behind `@media (prefers-reduced-motion: reduce)` |
| High contrast / forced colours | Test with `forced-colors: active`; never rely on background alone to convey selection (pair with a border or a glyph) |
| Screen readers | Navigation and reading fully operable; editing is announced. Full grid-editing announcement is a known hard problem — state the limitation honestly in the README rather than claiming full support |

## Motion

Minimal and purposeful: 120 ms ease-out on row insert/remove; no animation on scroll, typing or selection. Selection uses a border and a wash, not a scale or opacity transition.

## Harness viewport matrix

The Playwright harness renders the real grid against a fixture `RowSource` at:

| Name | Size | State |
|---|---|---|
| `desktop` | 1440 × 900 | default theme, dark theme |
| `phone-closed` | 390 × 844 | keyboard closed |
| `phone-keyboard` | 390 × 844, host squeezed to **389 px** | reproduces the historical failure (app shell compressed from 860 px) |
| `tablet` | 834 × 1112 | both orientations |

For each: toolbar visible and unwrapped, header sticky, no clipped controls, root fills 100 % of its host, no `!important` anywhere in the computed styles. On the wide viewports the frozen column is aligned; at 389 px (and in any pane under 600 px) it is **unpinned by design** — assert that the gutter and the first column scroll with the rest instead.
