# Plan — UI/UX + design-engineering pass ("Parchment Ledger")

> **Historical / superseded for the native refactor:** this plan governed a prior prototype-only design exercise and is not the current product contract or an active implementation instruction. Keep it as history. Any future native UI work must follow `docs/04-design-system-and-layout.md`, the native phase guides, and a new explicit user request.

**Status: plan only. Nothing implemented in this turn.** The prototype, `docs/`, and the published
repo are all unchanged. This file is a working artifact, not part of the docs contract; it is not to be
committed unless you ask.

**Inputs this plan reconciles**

| Source | What it binds |
|---|---|
| Your UI/UX Philosophy | Clarity first; simplicity over decoration; consistency; user control; accessibility; progressive disclosure; mobile-first; meaningful feedback; efficiency; purposeful design. *"When visual appeal and usability conflict, usability wins."* |
| `emil-design-eng` skill | Motion decided by **frequency** (100+/day ⇒ never animate); custom easing curves; only `transform`/`opacity`; popovers animate from their trigger; press feedback; `prefers-reduced-motion`; hover gated by media query; **every review delivered as a Before/After/Why table**. |
| `frontend-design` skill | Commit to a bold, specific direction; no generic fonts (no Inter/Roboto/Arial/system stacks for the identity), no clichéd palettes, no predictable layouts; every element intentional. |
| Standing project constraints | `isDesktopOnly: false` (mobile first-class); zero `!important`; theme-native CSS was the documented gate; bundle ≤900 KB / ≤300 KB gzip; ≤300 ms first paint at 5,000 rows; plugin publishes under your name with upstream attribution; **no third-party marks, names, or licensed typefaces, nothing implying affiliation**. |

## 0. Decisions locked in this round

| # | Decision | Ruling |
|---|---|---|
| D1 | Scope | **Both** — codify the standard in `docs/`, then apply it to the prototype. Doc set is the contract; the prototype proves it renders. |
| D2 | Aesthetic appetite | **Full commitment** — Tablify gets its own look: typography, spacing, layout language, texture. It will read as its own app rather than as stock Obsidian. |
| D3 | How boldness behaves in someone else's app | **Bold by default + one "Follow my Obsidian theme" switch.** Identity is what everyone sees and what screenshots show; the switch defers to the host with no `!important` and no broad theme overrides. |
| D4 | Identity source | **The design language, never the marks.** Warm parchment/ink/clay, humanist editorial typography, generous space, quiet hairlines, restrained shadows — plus a **"Tablify" wordmark you own outright**, drawn in that same editorial idiom. |
| D5 | Typography | **One open-licensed face** (subset, target ≤40 KB woff2) for display roles and numerals; the host's font stays for body text. |
| D6 | Motion | **The frequency table, enforced.** Nothing seen 100+ times a day animates. Motion exists only for occasional surfaces (popovers, modals, toasts) and press feedback. |
| D7 | Supersedes the earlier deferral | The palette is no longer "placeholder until supplied" — the identity values are derived from D4 and documented as **swap points in one file**, so real brand values can replace them later without touching components. |

**Hard line for D4, stated once so no stage can drift:** no Anthropic or Claude marks, wordmarks,
names, or typefaces; nothing in the palette's *composition* that copies their lockup; no motif that
resembles their starburst mark; no string "anthropic"/"claude" anywhere in the repo (CI grep gate,
§9). The borrowed thing is a *feeling* — warm paper, ink, clay, calm — expressed in values we choose.

## 1. Conflict rulings (the inputs genuinely disagree; this is the tiebreak)

| Conflict | Ruling | Consequence |
|---|---|---|
| "Bold, unforgettable" (frontend-design) vs "theme-native, zero `!important`" (existing gate) | D3: bold is the default *look*, host-theme mode is one switch away, and `!important` stays at zero | Tokens resolve **either** to identity values **or** to Obsidian variables (§3). Nothing else in the app is touched — we style only our own DOM. |
| Bold identity vs "simplicity over decoration" | Decoration must survive daily use or it is out: texture is static and near-invisible, colour carries meaning only with a second cue, no animated flourish on any frequent path | Identity is carried by **type, space, rule-work and one accent** — not by ornament |
| "Distinctive fonts" vs ≤300 ms first paint on mobile | One subset face, measured, for display + numerals only | `document.fonts` measured; body text never waits on a download |
| Progressive disclosure vs a dense data tool | Toolbar keeps **6 primary actions**; everything else moves behind `More`; per-view options stay in the view menu; the ⋯ menu groups by intent | Fewer visible controls, no lost function |
| "User control" vs a strong default look | The switch from D3 plus per-view overrides that persist | Nobody is stuck with our taste, and nobody has to configure it either |

## 2. The direction: **Parchment Ledger**

**Tone:** warm, editorial, precise, calm, tactile — a well-set ledger on good paper, not a dashboard.

**The one thing someone should remember:** a hairline-ruled grid on warm paper, with a **clay caret**
where the eye is, and numerals that line up like a printed table.

**Palette roles** (values derived in Stage 1, verified for contrast, all as sRGB hex for theme compatibility):

| Role | Light | Dark | Used for |
|---|---|---|---|
| `ink` | deep warm brown-black | warm off-white | primary text |
| `ink-muted` | warm grey-brown | warm grey | secondary text, numerals |
| `parchment` | warm off-white | deep warm charcoal (never pure black) | app surface |
| `parchment-raised` | white-warm | charcoal + 4 % | toolbar, header, dialogs |
| `sand` | warm pale line | warm dark line | every border, divider, rule |
| `clay` | terracotta | lightened terracotta | accent: active cell ring, selection, primary buttons, brand |
| `clay-quiet` | 8 % clay | 12 % clay | selection fill, chip background |
| `sage` / `amber` / `rust` | muted | muted | status: positive / warning / danger, always paired with an icon or label |

**Typography**

- Display + numerals: **one open-licensed face**, chosen in Stage 3 from a measured shortlist. Candidates: **Literata** (screen-first literary serif, tabular figures, calm), **Source Serif 4** (editorial, technical numerals), **Fraunces** (most distinctive, highest risk at 11–13 px numerals). Selection criteria, in order: OFL verified; `tnum` present; legible tabular numerals at 11–13 px; subset ≤40 KB; survives both light and dark.
- Roles: view title, dialog titles, section headers, empty-state headline, stat numbers, **all numeric cells**. Nothing else.
- Body, notes, long text: the host font (`--font-text`), unchanged — so a wall of note text always belongs to the user's theme.
- Numerals: `font-variant-numeric: tabular-nums` everywhere a number can align. This is a correctness feature, not a style one.
- Scale: a named ramp (11 / 12 / 13 / 15 / 20 / 28) with role assignments; no ad-hoc sizes after Stage 3.

**Space, borders, elevation**

- 4 px base, named steps (`--tablify-sp-1..8`); row heights stay 30 / 40 / 64; header 40; toolbar 44 on touch, 36 with a pointer.
- **Hairline rule-work is the signature**: 1 px `sand` borders, no double borders, no rounded-everything (radius only 3 / 6 / 10).
- Elevation only for surfaces that float: menus, popovers, modals — one soft shadow + one hairline, never a shadow stack. Grid cells never cast shadows.

**Atmosphere**

- A static paper grain (inline SVG noise, ≤1.5 % opacity) on the toolbar/header and the prototype shell, disabled in host-theme mode and in forced-colors. No animation, no `filter` on scroll paths.
- Selection is visible as `clay-quiet` fill **plus** the active-cell ring — colour never carries that meaning alone.

**Iconography**

- Replace every unicode/emoji glyph (🔗 ▣ ⣿ ↑ ↓ ✕ ⣿ …) with an inline SVG sprite: 24 px grid, 1.5 px stroke, `currentColor`, no fills, no rounded-cap cuteness. Sprite ≤12 KB, inlined (prototype must stay self-contained; the plugin ships it as a module).
- Icons are labelled: every icon-only control has `aria-label` and a tooltip.

**Wordmark (yours)**

- A **"Tablify"** lockup set in the chosen face, monochrome, `currentColor`, with a *column-rule mark*: a hairline vertical + horizontal meeting at a corner — the frozen-corner motif, drawn from scratch. No starburst, no orbit, no asterisk shapes.
- Deliverables: `wordmark.svg` (lockup), `mark.svg` (square, 16 px legible), plus clear-space and minimum-size rules, and a usage table (harness, settings tab header, README, directory listing).

## 3. Token architecture (`prototype/css/tokens.css`, then `tokens.css` in the plugin)

Three layers, one switch, no forks:

1. **Identity** — raw values: `--tablify-ink`, `--tablify-parchment`, `--tablify-clay`, `--tablify-sand`, …
2. **Semantic** — what components use: `--tablify-surface`, `--tablify-surface-raised`, `--tablify-line`, `--tablify-text`, `--tablify-text-muted`, `--tablify-accent`, `--tablify-accent-quiet`, `--tablify-selection`, `--tablify-focus`, `--tablify-danger`.
3. **Mapping** — each semantic token resolves to identity **or** host variables depending on mode. Mode is one attribute on the view root (`data-tablify-theme="identity|host"`), driven by the D3 setting. Host mode maps to `--background-primary`, `--background-secondary`, `--text-normal`, `--text-muted`, `--background-modifier-border`, `--interactive-accent`, `--text-on-accent` — i.e. the current behaviour, recoverable in one line per token.

Plus: motion tokens (`--tablify-ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--tablify-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`, `--tablify-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`, durations below), radius, elevation, density; `@media (prefers-reduced-motion: reduce)` and `@media (prefers-contrast: more)` blocks; forced-colors fallbacks for the focus ring and selection.

## 4. Motion spec — the frequency table applied to *this* product

Rules that follow from the skill: transition **specific properties**, never `all`; animate only `transform`/`opacity`; transitions (not keyframes) for anything interruptible; exit faster than enter; nothing animates on a keyboard-initiated action.

| Surface / interaction | Frequency | Duration | Easing | Properties | Notes |
|---|---|---|---|---|---|
| Arrow / Tab / PageUp / Home / End navigation | 100+/day | **0 ms** | — | — | Also applies to scroll-into-view: never smooth-scroll the grid |
| Typing in a cell, commit, cancel | 100+/day | **0 ms** | — | — | No transition on `.cell-editor` |
| Active cell / range change | 100+/day | **0 ms** | — | — | Instant ring; no grow, no pulse |
| Sort / filter / group / query change | tens/day | **0 ms** | — | — | Data changes instantly; a chip may fade opacity ≤120 ms |
| Row / cell hover | tens/day | ≤90 ms | `ease` | `background-color` | Gated by `(hover: hover) and (pointer: fine)` |
| Toolbar hover | tens/day | 120 ms | `ease` | `background-color`, `border-color` | No transform on hover in a dense toolbar |
| Button / chip / toolbar press | tens/day | 140 ms | `--tablify-ease-out` | `transform: scale(0.97)` | Applies to every pressable element, including dialog buttons |
| Menu / popover / select | occasional | 160 ms in, **120 ms out** | `--tablify-ease-out` | `opacity`, `transform: scale(0.97→1)` | **Origin-aware**: `transform-origin` set from the trigger; exit shorter than enter |
| Modal / dialog | occasional | 240 ms in, 160 ms out | `--tablify-ease-out` | `opacity`, `scale(0.98→1)` | Center origin (the documented exemption) |
| Mobile dialog → bottom sheet (≤600 px pane) | occasional | 300 ms in, 220 ms out | `--tablify-ease-drawer` | `translateY(100%→0)`, `opacity` | Percent-based translate; leaves room for velocity dismissal later |
| Toast | occasional | 260 ms in, 180 ms out | `ease` | `opacity`, `translateY(100%→0)` | Same direction in and out; timer pauses when the tab is hidden |
| Empty state / loading → content | first-time | 200 ms | `--tablify-ease-out` | `opacity` only | **No stagger** — this is a daily tool, not a landing page |
| First-run hint | once | none | — | — | Static text + one illustration |

Reduced motion: keep opacity and colour transitions, drop every movement/scale; nothing is required to be legible.

## 5. Component contracts (what changes, what must not)

The audit's checks — 78 as of the settings stage (67 when this plan was written) — are the contract: class names, `data-*` attributes and roles stay stable unless a stage explicitly migrates one.

| Surface | Change | Must not change |
|---|---|---|
| Toolbar | 6 primary actions + grouped `More`; press feedback; icon set; 44 px targets on touch; wrap behaviour re-specified | Button order, menu item labels the audit drives |
| Grid chrome | Hairline rule-work; `clay` caret + ring; group bar treatment; resize handles get a visible hit area, unchanged geometry | `.tablify-header/.tablify-rows/.tablify-frozen/.tablify-corner/.gutter/.cell[data-c]` contract, `GUTTER_W`, `BAR`, `HEADER_H`, the P21 narrow rule |
| Editors / popovers | Origin-aware entry; select popover keyboard path; rating/attachment visual pass; focus ring | `.pop`, `.cell-editor`, `.pop-item`, `is-picked`/`✓` semantics |
| Menus | Item grammar (icon · label · shortcut · ✓), danger/disabled styling, section headings | `it.section`/`it.hide`/`it.checked` API used by the harness |
| Modal shell + dialogs | Header/body/footer grammar, bottom-sheet variant at ≤600 px, focus trap + restore, the wizard gets a real step header | `modal(opts)` signature and *"whoever draws `body` owns `api.foot`"* |
| Toasts | Stacking, same-direction enter/exit, pause-when-hidden, action button styling | `TF.toast.show(message, kind)` signature |
| Status bar / save indicator | Typography + the save state as text + icon (never colour alone) | Existing state names |
| Empty + loading states | Typography pass; the empty state becomes useful (one clear next action) | Copy intent |
| Import wizard | Stepper grammar, preview table typography (this is where tabular numerals pay off) | Step order and the dry-run/warning logic |
| Sync + conflicts | Diff legibility: monospaced tabular numerals, tight leading, no zebra chaos; conflict rows scannable | Per-field resolution semantics |
| Legacy `.tabula` + dry-run | Hairline framing, clearer computed/orphan grouping | Wide top scrollbar behaviour |
| Settings tabs | Host-vs-identity switch lives here; per-view options grouped | Existing setting keys and storage |
| Prototype harness | Third toggle (Identity / Host theme) beside light/dark and phone; a new **Foundations** screen showing tokens, type ramp, icons, motion samples, wordmark | Harness control names the audit clicks |

## 6. Mobile-first pass (where the current build is weakest)

- 44 px minimum touch targets in narrow mode (today `.tablify-btn` is `min-height: 36px`).
- Hover never load-bearing: every hover rule gated by `(hover: hover) and (pointer: fine)` — today **23 hover rules are ungated**, which is a direct mobile-first violation.
- Dialogs become bottom sheets at ≤600 px pane width; safe-area insets respected; nothing under the keyboard.
- Inputs ≥16 px on touch (no iOS zoom) — verify the search/query/editor fields.
- Long-press affordances re-verified after the visual pass; the P21 rule (nothing pinned when narrow) stays.
- Long-press, tap and drag all get visible feedback states (the philosophy's "meaningful feedback").

## 7. Accessibility pass

- One global `:focus-visible` ring from `--tablify-focus-ring`, on every focusable element; `outline: none` only where a replacement ring exists (today: search, query, cell editor have `outline: none` and no ring).
- Contrast **measured, not assumed**: script computes ratios for every text/surface and non-text pair; gates: 4.5:1 body, 3:1 large text and UI boundaries, 3:1 focus indicator against both adjacent colours. The current palette values are placeholders and will be replaced by measured ones.
- Never colour alone: selection = fill + ring; status = colour + icon + label.
- Reduced motion, `prefers-contrast: more`, forced-colors fallbacks.
- Modal focus trap and focus restore on every dismiss path; roving tabindex preserved; `aria-live` announcements preserved and extended to the new feedback states.

## 8. Deliverables

**Docs (the contract)**
- `docs/13-ui-ux-standard.md` — the philosophy + both skills as binding rules, the Before/After/Why review format, the acceptance checklist below, and the refusal list (brand/legal line).
- Rewrite `docs/04-design-system-and-layout.md` around the token layers, motion spec, component contracts, wordmark rules.
- `AGENTS.md` — pointer plus: *every UI change ships with a Before/After/Why table and the checklist answered.*
- `docs/12-agent-prompt-pack.md` — add the design rules to the prompts your agent will run.

**Prototype (the proof)**
- `css/tokens.css` (new), refactors of `tablify.css` and `obsidian.css`, embedded subset font (data URI) + SVG sprite + wordmark, the harness identity switch, the **Foundations** screen, `shots/` refreshed in light/dark × desktop/phone.
- `DESIGN-REVIEW.md` — the executed pass as Before/After/Why tables.

**Repo hygiene**
- `NOTICE` gains the font's OFL attribution next to the upstream attribution; `.gitignore` unaffected; the brand-string CI gate (§9).

## 9. Verification (every stage ends green, or it is not done)

Existing: 67/67 interaction audit, 37/37 jsdom smoke, scroll verification, `node --check` on all files.

New checks (extend `tests/interaction-audit.js`, add `tests/design-audit.js`):
1. `prefers-reduced-motion: reduce` emulated ⇒ no transform/scale transitions on menus, popovers, modals, toasts; opacity allowed.
2. Touch emulation at 389 px ⇒ hover styles inert (no `:hover` matches), every pressable ≥44 px tall.
3. Keyboard path ⇒ `:focus-visible` ring present on toolbar, grid, dialogs; ring visible after menus close.
4. No `transition: all`, no `width`/`height`/`padding`/`margin` transitions anywhere (static grep + computed-style probe).
5. Contrast script (`tools/contrast.js`) reads `tokens.css` and fails under threshold — both modes.
6. Brand gate: grep fails on `anthropic|claude` in the repo and on any non-OFL font file.
7. Fonts: subset ≤40 KB, `tnum` applied to numeric cells (computed style), first paint at 5,000 rows still ≤300 ms, mounted cells still <1,200, editor-open still ~130 ms.
8. Tooltip behaviour: first tooltip delayed, subsequent ones instant.
9. Modal: focus trapped, Escape closes, focus returns to the trigger.
10. Wordmark present, monochrome (`currentColor`), and does not appear in host-theme mode's screenshots.

## 10. Stages

| Stage | Work | Exit criteria |
|---|---|---|
| **0. Baseline review** | Produce the full Before/After/Why table for today's UI (the format the skill requires) | Review table committed to `DESIGN-REVIEW.md`; no code |
| **1. Tokens + honesty fixes** | `tokens.css`, theme mapping + switch plumbing, remove the stray `!important`, global `:focus-visible`, contrast script | Suites green; contrast gates pass in both modes; DOM untouched |
| **2. Motion layer** | Press feedback, origin-aware popovers, modal/toast timing, reduced-motion and hover gating | New checks 1, 2, 4 green; no timing regressions |
| **3. Identity** | Font shortlist → measured choice → subset + `NOTICE`; icon sprite; wordmark; type ramp | Checks 6, 7 green; bundle within budget |
| **4. Components** | Toolbar & status bar → grid chrome → dialogs/wizard → sync/legacy/settings | 67/67 after each sub-stage; screenshots refreshed |
| **5. Mobile-first** | Bottom sheets, 44 px targets, input sizes, safe areas, long-press feedback | Checks 2, 9 green at 389 px + touch |
| **6. Foundations + docs** | Foundations screen in the harness; `docs/13`, `docs/04`, `AGENTS.md`, prompt pack; add the new doc to the `START-HERE.md` / `README.md` index | Docs cross-references clean (no reference to a file that does not exist); harness toggle demonstrates both modes |
| **7. Close-out** | Full suite + design audit + performance numbers + README/report counts | All green; numbers recorded; review table complete |

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Bold default fights user themes (the classic complaint, and a community-review concern) | D3's switch; zero `!important`; only our own DOM; grep gate that no theme variable is overridden globally |
| DOM churn breaks the 67-check contract | Class names and `data-*` are frozen; sub-stage suite runs; a failing check blocks the stage |
| Bundle/mobile budget | One subset face ≤40 KB, sprite ≤12 KB, measured before and after; grain is SVG, not an image |
| An embedded serif next to a theme's body font looks mismatched | The face is restricted to display roles and numerals; body always follows the theme |
| Accidental resemblance to third-party branding | Explicit refusal list (§0), wordmark drawn from our own motif, brand grep gate, and a side-by-side check before publishing screenshots |
| Motion sneaking into frequent paths | The frequency table is the review checklist item; new checks 1 and 4 enforce it mechanically |
| Scope creep under "full bold" | §5 is the boundary; anything not listed needs its own entry and a reason |

## 12. Open items for you

1. **Font pick** — I will bring three candidates at Stage 3 with real measurements (subset size, numeral legibility at 11–13 px, light/dark samples) and you choose. If you already have a face in mind, name it and I will verify its licence first.
2. **Wordmark involvement** — if you want to shape the mark yourself, say so and Stage 3 delivers the three candidates'd raw geometry instead of a finished lockup.
3. **Screenshots** — the README/directory listing will show the identity mode by default. Confirm that is what you want presented publicly, or I will show both modes side by side.
