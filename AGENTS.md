# AGENTS.md — implementation rules

Instructions for any coding agent (or human) working in this repository. These are constraints, not suggestions. If a task appears to require breaking one, stop and raise it as a decision in `docs/08-decisions.md`.

## Commands

```bash
bun install                 # install (bun.lock is the lockfile; never commit node_modules)
bun run dev                 # esbuild watch → main.js
bun run build               # tsc --noEmit && esbuild production bundle
bun run typecheck           # tsc --noEmit only
bun run lint                # eslint .
bun run lint:fix            # eslint . --fix
bun run format              # prettier --write .
bun run test                # vitest run (unit + integration)
bun run test:watch          # vitest
bun run test:layout         # playwright test (layout harness)
bun run check               # typecheck && lint && test && build  ← run before every commit
```

## Architectural boundaries (enforced by lint, do not `eslint-disable`)

```
src/core/**      pure TypeScript. MUST NOT import obsidian, react, or any DOM API.
src/grid/**      React. MUST NOT import obsidian except for Menu/Modal/Notice from a
                 single re-export in src/plugin/obsidian.ts.
src/adapters/**  the only code that reads/writes data. MUST NOT import react.
src/sync/**      network. MUST NOT import react. MUST be dynamically imported.
src/plugin/**    Obsidian glue. The only layer allowed to touch the workspace API.
```

Import direction is one-way: `plugin → adapters → core`, `plugin → grid → core`. Never the reverse. Cross-layer reach-arounds are the single most common way this codebase will rot.

## Conventions

- **TypeScript:** `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters`. No `any`; use `unknown` + narrowing. No non-null `!` on values that can be null at runtime.
- **Field types:** every field type is one file in `src/core/fieldTypes/`. Never add a `switch (field.type)` outside that directory. If you need type-specific behaviour elsewhere, extend the registry's descriptor instead.
- **State:** components read state through selector hooks (`useCell`, `useRow`, `useSelection`). Never pass a document down as a prop; never pass more than **8 props** to a component.
- **DOM writes:** all mutations go through `core/ops/**` and are applied by the store as commands. A component never mutates state directly.
- **Async:** adapters expose one async `flush()` per write batch. Never `await` inside a render or a keystroke handler — enqueue.
- **CSS:** add classes to `src/grid/styles/*.css` using tokens from `tokens.css`. No literal colours, no `!important`, no selectors deeper than two levels.
- **Naming:** user-facing strings are sentence case; command ids are `verb-noun` (`tablify:insert-row-below`), never containing the plugin id twice.
- **Tests:** new behaviour in `core/` or `adapters/` requires a unit test in the same commit. A layout or interaction fix requires a Playwright harness case in the same commit.

## Never do

1. `!important` in CSS, or a hardcoded colour outside `brand.css`.
2. A layout that depends on a parent's computed height chain. The grid root is `position: absolute; inset: 0` inside the host container.
3. `window.addEventListener` / `document.addEventListener` — use `registerDomEvent` or React's `useEffect` cleanup.
4. `workspace.requestSaveLayout()` outside genuine layout changes (never on a keystroke).
5. Write to a `TFile` directly. Writes go through `adapters/bases` so they are debounced, batched and undoable.
6. Read or write an Airtable token except through `SecretStorage`.
7. Add a runtime dependency without recording it in `docs/08-decisions.md`. Bundle size affects Obsidian **mobile startup** — this is a product constraint, not a preference.
8. Ship a release whose git tag differs from `manifest.json` `version`, or that includes a `v` prefix.
9. Change `manifest.json` `id` after the first public release. Ever.
10. Reference another company's trademark (Anthropic, Claude, Airtable, Notion) in the plugin name, description, README or settings copy.

## Definition of done

A change is done when: `bun run check` passes, the boundary lint is clean, the layout harness is green at all three viewports, `docs/` reflects any decision made, and the change is shippable on its own (no half-migrated state).
