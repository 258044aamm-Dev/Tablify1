# 04 — Design system, layout contract, and accessibility

> **Status:** target UI contract for the planned `.tablify` custom file view. Preserve the current grid’s proven responsive/accessibility behavior; this document does not imply the new file view exists in `0.1.0`.

## Design goals

1. Use Obsidian’s host theme variables for surfaces and typography; Tablify supplies a restrained accent, not a competing application chrome.
2. Fill the container given to the custom file view; do not negotiate height through ancestor chains.
3. Keep the same grid interaction model at desktop, tablet, narrow pane, and phone sizes.
4. Make focus, selection, status, broken links, pending writes, and save errors distinguishable without relying on color alone.
5. Keep all behavior accessible by keyboard; mobile gestures supplement, never replace, keyboard navigation.

## Token tiers

```text
tier 1 — Obsidian theme variables (read, never redefine)
tier 2 — Tablify semantic/brand tokens
 tier 3 — grid/editor components using only tier 1 and tier 2
```

### Host tokens

| Purpose | Preferred source |
|---|---|
| Main surface | `--background-primary` |
| Raised/header surface | `--background-secondary` |
| Hover surface | `--background-modifier-hover` |
| Selection wash | `--background-modifier-active-hover` plus an explicit border/glyph |
| Borders | `--background-modifier-border` |
| Main/muted text | `--text-normal`, `--text-muted`, `--text-faint` |
| Primary action | `--interactive-accent`, `--text-on-accent` where available |
| Focus | `--background-modifier-border-focus` or a contrast-tested Tablify focus token |
| Font/radius | Obsidian UI font variables and radius variables when appropriate |

### Tablify semantic tokens

Use semantic names such as `--tablify-accent`, `--tablify-selection`, `--tablify-focus-ring`, `--tablify-danger`, and `--tablify-row-height`. Palette values belong in one token file. Do not spread literal colors through component CSS. Verify text contrast (4.5:1 body; 3:1 large text/UI boundaries) in both host themes; verify forced-colors behavior.

- Accent is for focus, selection, and primary action—not success/error meaning.
- Option colors are labels, not the only way to identify a status.
- `!important` is not an allowed conflict-resolution strategy.

## File-view layout contract

The Obsidian FileView provides a host container; the plugin fills it and owns one grid scroller.

```text
Obsidian FileView host (size supplied by workspace)
└─ .tablify-root                 absolute; inset: 0; flex column; overflow hidden
   ├─ database/table/view bar     fixed controls; responsive overflow below narrow width
   ├─ toolbar                     fixed; never wraps into a clipped second row
   ├─ .tablify-scroller            the only grid scroller
   │  ├─ virtual canvas
   │  ├─ windowed rows
   │  ├─ sticky header layer
   │  └─ frozen-primary layer only when pane width ≥ 600 px
   └─ status region               polite write/status announcements as appropriate
```

Rules:

- One scroller; header/rows stay aligned during horizontal and vertical movement.
- Grid root fills the FileView’s actual host box; do not rely on percentage-height chains above it.
- No `100vh` for mobile geometry. Use `visualViewport`/safe-area behavior only if verified in Obsidian’s target WebViews.
- Frozen primary column is unpinned below 600 px pane width; row-number/selection gutter scrolls with the remaining grid. Hide the freeze option while unavailable rather than presenting a no-op control.
- Layout listeners/subscriptions are registered and disposed with the file view; no leaked global handlers or observers.

## Responsive and mobile behavior

| Concern | Requirement |
|---|---|
| Inputs | At least 16 px to avoid iOS focus zoom. |
| Touch targets | At least 44×44 px where practical; maintain existing minimum row geometry and document exceptions. |
| Keyboard | Keep the active editor/cell visible when the software keyboard opens; restore scroll/focus on close. |
| Safe areas | Respect top/bottom insets for toolbar and status controls. |
| Context menu | Long-press with visible affordance, plus a discoverable toolbar/menu action. Long-press must not steal ordinary scrolling. |
| Hover | Never make an essential control appear only on hover. |
| Toolbar | Collapse low-frequency actions into an overflow menu on narrow panes; no clipped/wrapped toolbar. |
| Motion | Honor reduced-motion preference; frequent selection/typing/scroll paths do not animate unnecessarily. |

## Accessibility contract

- Use grid semantics (`role=grid`, row/cell/header roles, row/column counts and indices that account for virtualization).
- One clear keyboard focus model (roving `tabindex` or a documented equivalent) with visible focus and no keyboard trap.
- Expose `aria-selected`, read-only reasons, active table/view names, link target labels, and broken-reference state.
- Use a polite live region for completed writes/errors, not for every arrow-key selection movement.
- Dialogs and menus restore focus on close; keyboard-only users can create/remove a linked record and reach table/view controls.
- Selection is conveyed by border/shape/icon as well as color; forced-colors mode remains legible.
- State screen-reader editing limitations honestly until verified on actual screen readers.

## Verification viewports

Keep the repository’s current Playwright matrix: desktop, desktop-dark, phone with keyboard closed, phone with keyboard open/squeezed host, and tablet. Preserve existing geometry, input-size, focus, scroll, tap-target, frozen-column, and performance assertions. Add fixture states with multiple tables/views and linked-record cells. The browser harness cannot prove Obsidian FileView host lifecycle or real keyboard/compositor behavior; those remain manual device checks.

## Design changes are not scope changes

The `.tablify` refactor changes the host/data architecture, not the user’s established grid interaction model. Any removal of an existing gesture or accessibility behavior requires an explicit decision and an updated acceptance test before implementation.
