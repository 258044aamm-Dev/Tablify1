# AGENTS.md — repository rules and refactor boundary

Instructions for any agent or human working in this repository. The current `0.1.0` source is still Bases-backed; the native `.tablify` architecture below is the target, implemented phase by phase under named authorizations. The repository is **plan-only by default**: change documentation only when explicitly requested; do not edit application code, tests, styles, package/manifest/version files, release assets, or vault data unless the user has authorized that specific work. Authorisation is per task, never implied by a previous task. **Standing authorization (2026-10-07): implement phases R1–R5, one step at a time, pushing to `refactor/native-tablify` after every step.** R6, release metadata, version tags, release assets and new runtime dependencies stay under the default fence. See [`docs/08-decisions.md`](docs/08-decisions.md) §Implementation authorization log.

## Source-of-truth order

1. The user’s latest explicit instruction and confirmed product scope.
2. [`docs/08-decisions.md`](docs/08-decisions.md) for confirmed decisions and phase-blocking open ADRs.
3. [`docs/01-spec.md`](docs/01-spec.md), [`docs/02-architecture.md`](docs/02-architecture.md), [`docs/03-data-model-and-migration.md`](docs/03-data-model-and-migration.md), and the [R0–R6 phase guides](docs/README.md) for the future target (all clearly status-labelled).
4. [`docs/REFACTOR-PLAN.md`](docs/REFACTOR-PLAN.md) for the audit that produced the target and the phase work plan.
5. Current source, `package.json`, manifest, and current release history for what is actually implemented.
6. [`docs/legacy/**`](docs/legacy/README.md) as **history only**. It is the frozen record of the Bases-backed product (its specs, step log, prototype, spike, design plans, and the archived prompt set). It never overrides the native direction, is never edited, and nothing in it may be implemented from or cited as a current requirement.

If current code and target docs differ, state whether a claim refers to `0.1.0` or the planned refactor. Never describe a planned feature as implemented.

## Current commands

```bash
bun install --frozen-lockfile
bun run dev
bun run build
bun run typecheck
bun run lint
bun run test
bun run test:layout
bun run check
```

`bun run check` is the current package gate; CI additionally runs the Playwright layout suite. Use the current `package.json` as truth if a copied command differs. Do not claim a gate passed unless the command was run and its result is available.

## Architectural boundaries

Current source boundaries are lint-enforced and must be preserved while the refactor is planned:

```text
src/core/**       pure TypeScript; no Obsidian, React, DOM, filesystem, or network
src/grid/**       React/UI; no direct persistence or adapter-specific source imports
src/adapters/**   persistence/data adapters; no React
src/sync/**       provider/network logic; no React; invoked only by explicit sync actions
src/plugin/**     Obsidian workspace, file-view, lifecycle, settings, and composition glue
```

The future native direction is:

```text
plugin FileView → database repository/session → validated DatabaseState
                                       └───────→ active-table projection → grid
```

Stable database/table/field/row/view IDs are data identity. File path is only a current host location. All `.tablify` writes go through a serialized database repository and operation/store path; core never uses Obsidian APIs. Exact write API and atomicity must be verified before implementation.

## Frozen material

`docs/legacy/**`, `prototype/**` (now under it), `tools/**` and the archived prompts are reference material for humans, not part of any module graph:

- Never edit a file under `docs/legacy/**`; it is the historical record. If it is wrong, correct the live docs, not the record.
- Never implement a behaviour because `docs/legacy/**` describes it. The `0.1.0` storage model (note-backed rows, `.base` sidecars, `.tabula` files) is deliberately retired.
- Nothing under `src/**` may import from frozen material, and the lint boundary that enforces this must not be weakened.

## Legacy code policy during transition

- Existing `BasesSource`, `BasesView`, note/frontmatter storage, and `.tabula` parser remain only because they are part of the current 0.1.0 build. Do not add new features to them under the native plan.
- No new Bases mode, Bases fallback, `.base` migration, `.tabula` support, or note-row import path is part of the target.
- Do not treat Airtable’s remote “base”/`baseId` terminology as Obsidian Bases integration; Airtable sync is retained by user decision.
- Do not remove legacy code until the replacement exists and the R6 acceptance gate authorizes cutover.

## Engineering conventions

- TypeScript strictness, no `any`, no unsafe non-null assertions, no silent catches, and no weakened/skipped tests.
- Field-specific behavior belongs in the field registry or a typed core operation; avoid duplicated `switch(field.type)` logic.
- React components use selectors/commands; they do not mutate persisted state directly.
- Async writes use an explicit queue/flush contract; do not await in render paths.
- CSS uses tokens, no `!important`, and the responsive/accessibility contract in `docs/04-design-system-and-layout.md`.
- Runtime dependencies require an ADR with version, need, and bundle/mobile impact.
- Secrets use only Obsidian `SecretStorage`; no telemetry or unapproved network calls.

## API verification

Before using an Obsidian API, cite the pinned symbol in `node_modules/obsidian/obsidian.d.ts`, including `@since`, and check the relevant official docs. For the future custom file view, prove extension routing, load/unload, rename/modify events, and write behavior against an actual supported Obsidian app. Do not use the old Bases spike as evidence for FileView behavior.

## Documentation and decision rules

- Future product contracts must say “planned/not implemented” until code ships.
- Preserve historical `CHANGELOG.md` and the frozen record under `docs/legacy/**` (including `PROGRESS.md` and the `0.1.0` tag/release history). Correct false present-tense claims without rewriting history.
- Resolve open design questions in an ADR before the dependent phase. Recommendations in a phase guide are not user approval.
- Do not alter `manifest.json`, `package.json`, `versions.json`, `bun.lock`, `main.js`, or release tags as a side effect of a documentation task.

## Definition of done

For code work (only after authorized): scope fence matches `git diff --stat`; `bun run check` and applicable `bun run test:layout` are green; manual gates are recorded; docs match actual shipped behavior; no compatibility/migration claim is invented. For documentation-only work: cross-links resolve, current-vs-target status is explicit, and `git diff --check` passes. Never commit or tag unless explicitly asked.
