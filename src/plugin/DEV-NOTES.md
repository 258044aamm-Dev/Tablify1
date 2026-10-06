# Developer notes — current 0.1.0 and planned native view

> **Do not confuse current and target behavior.** The checked-in `0.1.0` plugin is Bases-backed. It does not open or write a `.tablify` database file. The native file view is a future refactor documented in [`docs/reference/REFACTOR-PLAN.md`](../../docs/reference/REFACTOR-PLAN.md) and [`docs/reference/native-tablify/`](../../docs/reference/native-tablify/README.md).

## Current 0.1.0 scratch-vault procedure (historical/current implementation only)

Use a disposable vault, not a user's production vault. The current release procedure is in `README.md` and `docs/09-publishing.md`; build commands come from `package.json`. The current view needs Obsidian Bases enabled and renders note-backed rows. Do not use this procedure to verify future `.tablify` behavior.

The 0.1.0 manual test status remains `NOT RUN` for real desktop/phone checks in `docs/manual-test-log.md`. A successful browser harness is not a substitute.

## Native `.tablify` implementation investigation (future R2)

When implementation is separately authorized:

1. Read the pinned `obsidian@1.13.1` type declarations and official custom-view / extension-routing references.
2. Verify `registerView`, extension routing for `tablify`, file load/unload, rename/modify events, and the supported file-write API in a throwaway plugin/scratch vault before choosing the adapter interface.
3. Test on the oldest desktop and mobile Obsidian versions intended for support. Do not assume a `FileView` callback or write guarantee from memory.
4. Build the repository and fake-file tests before mounting the existing grid.
5. Test corrupt/future-version files and external edits to prove the file is preserved and newer state is not silently overwritten.
6. Do not use `BasesView`, `registerBasesView`, `.base` config, `processFrontMatter`, note paths as row IDs, or `.tabula` parsing in the target implementation.

## Product-document precedence

- Current behavior for the current release: source and release metadata at the audited commit, plus the historical `0.1.0` changelog.
- Target behavior: `docs/01–08` and the R0–R6 phase guides, with open decisions explicitly marked.
- If a future implementation is authorized, obey `AGENTS.md` and the file fence in the specific phase prompt. Plan-only mode does not authorize application code.
