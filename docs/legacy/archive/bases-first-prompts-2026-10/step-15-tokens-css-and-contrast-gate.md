Task: create the stylesheet foundation — one token file that owns every colour, a brand layer, the grid's
layout CSS, and a contrast gate that runs in CI. Zero `!important` is a build failure from this step on.

Read first: `docs/04-design-system-and-layout.md` (the whole file: token layers, the palette, the type
scale, spacing, the layout contract, the motion rules and the frequency table), `docs/01-spec.md` §look;
the reference values live in `prototype/css/tokens.css` and `prototype/css/tablify.css` — read them for the
identity palette and the measured light/dark values, then write the plugin's own files (do not copy the
prototype wholesale: the plugin has a single class prefix and no `data-*` compatibility shims).

Deliverable:

1. `src/styles/tokens.css` — three layers exactly as the doc describes:
   - **identity**: the raw palette as `--tablify-<hue>-<step>` values, including the dark set under
     `.theme-dark`;
   - **semantic**: `--tablify-surface`, `--tablify-surface-raised`, `--tablify-text`, `--tablify-text-muted`,
     `--tablify-line`, `--tablify-accent`, and the state colours, each defined once per mode;
   - **host mapping**: the `:root[data-tablify-theme="host"]` block that reads Obsidian's own variables
     (`--background-primary`, `--background-secondary`, `--text-normal`, `--text-muted`,
     `--interactive-accent`, `--background-modifier-border`) so the "follow my Obsidian theme" switch
     works with **zero** overrides of host variables and zero `!important`;
   - the spacing scale, the type scale (with the display roles the docs name), the radius scale, the
     motion tokens (durations, easings — the exact curves from the doc) and the tap-target minimum;
   - a `@media (prefers-reduced-motion: reduce)` block that zeroes every duration token.
   Every token carries a one-line comment naming where it is used.
2. `src/styles/brand.css` — the brand layer: the wordmark's sizing rules (the SVG itself arrives with the
   identity step; here you define the class and the layout slot) and the accent treatments that are allowed
   to differ from the host theme. Nothing else.
3. `src/styles/grid.css` — layout only, no colours except through tokens:
   - `.tablify-root { position: absolute; inset: 0; display: flex; flex-direction: column; }` and the three
     regions under it (toolbar, grid area, status bar) with the documented min-heights,
   - the grid area: one scroller, sticky header row, the frozen primary column as a transformed layer,
     the row lane, and the two scrollbars' geometry (the top horizontal bar and the vertical bar),
   - **no** percentage-height chains, no `100vh`, no height anchors, no `will-change` on scrolling layers,
   - comment each block with the measurement it implements.
4. `styles.css` at the repo root becomes a thin entry that `@import`s the three files in order, or an
   esbuild step that concatenates them — choose one, state which in the report, and make sure
   `bun run build` produces it. (`main.js` and `styles.css` are the shipped assets.)
5. `scripts/contrast.ts` — port the prototype's gate (`tools/contrast.js` is a working reference, including
   its `@contrast` comment convention): read the `@contrast <fg> on <bg> min <ratio>` declarations from
   `src/styles/tokens.css`, resolve the tokens per mode, compute the WCAG 2.1 ratio for light, dark and
   host mode where a host value is defined in a fixture, and exit 1 on any failure. Informational pairs
   (decorative hairlines) use `@contrast-info` and are reported but not gated. Declare at least the pairs
   the prototype gates, and declare the new ones you introduce.
6. `scripts/css-gate.ts` — fails if any built stylesheet contains `!important`, if any file under
   `src/styles/` contains a colour literal (`#`, `rgb(`, `hsl(`) outside the identity layer of
   `tokens.css`, or if any stylesheet declares a `--tablify-*` token outside `tokens.css`.
7. `package.json` — add `contrast` and `css:gate` scripts and include both in `check` after `build`.
8. `tests/unit/tokens.test.ts` — every semantic token resolves in all three modes (assert with
   `getComputedStyle` in jsdom against a loaded stylesheet, or by parsing if jsdom cannot resolve custom
   properties — state which you did); the reduced-motion block zeroes the duration tokens.

Constraints and fence:
- Touch `src/styles/**`, `styles.css`, `scripts/contrast.ts`, `scripts/css-gate.ts`, `package.json`,
  `esbuild.config.mjs` (only to emit `styles.css`), `tests/unit/tokens.test.ts`, `PROGRESS.md`.
- No `!important` anywhere, ever, including in a comment that a naive grep would catch — if a comment must
  mention it, write it as `! important`.
- No colour literal outside the identity layer. No new dependency (the contrast maths is ~30 lines).
- Do not restyle Obsidian's own UI elements (`.modal`, `.menu`, `.input`) — the plugin styles its own
  surfaces; dialogs and menus use Obsidian's components with the plugin's tokens applied through their
  documented class hooks only if the docs allow it.

STOP and report instead of proceeding if: the doc's layout contract cannot be met without a
percentage-height chain (paste the contract sentence and the measurement that conflicts); or a contrast
pair the prototype gates fails with the plugin's values (report the value you would change and the ratio);
or host-mode mapping requires overriding a host variable.

Acceptance (paste raw output):
- `bun run check` — green, now including `contrast` and `css:gate`.
- `bun run contrast` — the full table with modes, ratios and minimums, ending with the pass count.
- `bun run css:gate` — green; then add `color: red !important;` to `grid.css`, show it fails, and revert.
- The token count: how many `--tablify-*` declarations live in `tokens.css`, and the assertion that zero
  live anywhere else.

REPORT BACK with: the file list; the raw gate output; the token inventory (identity → semantic → host) with
counts; the contrast table; how `styles.css` is assembled and its byte size; anything ASSUMED; the exact
next step.
