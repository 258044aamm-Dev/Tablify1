# R2 — Repository and Obsidian file-view planning

**Guide:** `docs/R2-repository-and-file-view.md`
**Mode:** authorized for implementation (2026-10-07), on `refactor/native-tablify`, one step at a time with a push after each step; starts after R1's exit gate. The planning task below is the phase's plan of record.

Read `AGENTS.md`, `docs/02-architecture.md`, `docs/05-toolchain-and-ci.md`, `docs/08-decisions.md`, the R2 guide, `package.json`, and the pinned Obsidian declaration. Use official Obsidian docs only for corroboration; local pinned typings are required evidence.

## Plan-only task

Return a minimal API verification plan and proposed repository lifecycle. Explicitly enumerate:

- `FileView` extension registration and API symbols with local declaration line and `@since`;
- create/open/close/rename/modify/multi-pane lifecycle;
- validated document load and read-only/error state for malformed/newer formats;
- serialized writes, revision check, external edit, failure, flush, unsubscribe and dispose;
- a throwaway scratch-vault proof matrix for desktop and minimum mobile Obsidian;
- fake repository tests and manual checks.

Do not infer atomicity or claim a method is safe based on its name. Do not claim this API work is verified if local declarations or a real app test are unavailable — the desktop/phone probe kit is user-run (`docs/10` §7), and its rows stay `NOT RUN` until the user reports their result.
