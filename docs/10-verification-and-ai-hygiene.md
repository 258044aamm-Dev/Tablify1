# 10 — Verification and AI hygiene for the native refactor

> **Status:** evidence protocol for the planned `.tablify` work. This file is not proof that the target implementation exists or that its API assumptions have been verified.

## 1. Verification rule

A plan or implementation claim is not verified because it sounds plausible or appears in another generated document. Tie each important claim to one of:

- the checked-out repository at a named commit;
- a type declaration at a named package version;
- official Obsidian documentation;
- an executed test/build command with observed output;
- a real Obsidian desktop/mobile session recorded in `docs/manual-test-log.md`.

State facts as `VERIFIED`, `ASSUMED`, `OPEN`, or `NOT RUN`. A `NOT RUN` manual check is not a failure, but it must never be described as passing.

## 2. Repository audit ledger

Audit baseline: `258044aamm-Dev/Tablify` `main` at `50f041f135abe9e7e9f111cf7c170b32dc98e9e0`, tag `0.1.0`, inspected 2026-10-06. Use the actual checkout as evidence; recheck line numbers before citing them later.

| Claim | Status | Evidence | Consequence |
|---|---|---|---|
| Current runtime view is Bases-backed. | VERIFIED | `src/plugin/TablifyView.ts` extends `BasesView`; `src/plugin/main.ts` registers the Bases view. | Replace the host view and registration for the target. |
| `RowSource` is not a native `.tablify` database source. | VERIFIED | `src/adapters/RowSource.ts` has `bases` and `tabula-file` kinds; no live `.tablify` implementation was found. | A new multi-table repository is needed; merely renaming a kind is insufficient. |
| Current core state is single-table/note-path-oriented. | VERIFIED | `src/core/ops/types.ts`, query/view/store contracts, and adapter methods use `filePath`; `TableState` is one table. | R3 must replace identity and scope across operations, selection, store, and sync. |
| Current core has YAML/frontmatter semantics. | VERIFIED | `src/core/types.ts`, field descriptors, property schema, and `BasesSource` contain `YamlValue`/`toYaml`/note-context contracts. | Keep clipboard text conversion; replace native persistence conversion. *Settled 2026-10-07 by R3 step 3: the three YAML aliases and `toYaml` are gone from `src/**`, `FieldContext` no longer carries a path, and the descriptors write the document's canonical JSON (`docs/R3-identities-operations-and-undo.md` §Step 3). The row describes the audit baseline at `50f041f`, which was true when it was written.* |
| `.tablify/` currently stores sync metadata, not a database document. | VERIFIED | `src/sync/LinkStore.ts` uses `.tablify/links/`; no `.tablify` database-file view/source is registered. | Keep filename extension and metadata-directory meanings distinct. |
| `.tabula` reader/migration code exists but is not a live `RowSource`. | VERIFIED | `src/adapters/tabulaFile/**`, `src/core/migrate/**`, import wizard’s disabled `.tabula` path, `RowSource.ts`. | Remove the promise and code during cutover; do not preserve a phantom viewer. |
| Airtable sync uses Bases path/view and note-path IDs. | VERIFIED | `src/plugin/sync/host.ts`, `local.ts`, `src/sync/LinkStore.ts`, `pullPush.ts`. | Re-key to database/table/row/field identities after schema stabilizes. |
| Current plugin id/version/minimum are `tablify`/`0.1.0`/`1.13.0`. | VERIFIED | `manifest.json`, `package.json`, tag/release. | Preserve id and tag; choose distinct version for future release. |
| `.tablify` JSON multi-table, links v1, and no old migration are the target. | USER-CONFIRMED | User scope in the conversation, recorded in `docs/08-decisions.md`. | Do not reopen without asking. |
| Custom file-view APIs can open `.tablify` on the intended oldest desktop/mobile app. | OPEN | Typed surface read 2026-10-07 from pinned `obsidian@1.13.1`: `Plugin.registerView` / `Plugin.registerExtensions` @since 0.9.7; `FileView` with `onLoadFile`, `onUnloadFile`, `onRename`, `setState` (@since 0.9.7), `canAcceptExtension` (@since 0.9.7). App-version behaviour needs the user-run kit [`probes/r2-file-view/`](../probes/r2-file-view/README.md) on desktop and phone. | R2 API spike blocks implementation claims; typings are not the app (ADR-0010). |
| Obsidian write APIs provide the needed atomic/revision behavior. | OPEN | Signatures read 2026-10-07 from pinned `obsidian@1.13.1`: `Vault.read/create/modify/process/append/rename/delete` and events `modify`/`rename`/`delete`; `Vault.process` is the read-modify-write call (one round trip, no read/write gap). Whether a write notifies and what survives a crash is a real-vault question — kit step 2. | Do not claim crash durability; test/write strategy must be evidence-based. |
| Link cardinality, inverse fields, relation delete rules, manual row order, and external-edit UX are settled. | VERIFIED | Accepted ADR-0001 through ADR-0005; core invariant/operation/session tests include `tests/unit/core-link-invariants.test.ts`, `tests/unit/core-operations.test.ts`, and `tests/unit/tablify-session.test.ts`. | R4 UI work must implement the accepted behavior; real FileView and device behavior remains OPEN/NOT RUN. |

## 3. Official API references

- [Obsidian custom views](https://docs.obsidian.md/Plugins/User+interface/Views) describes custom view registration/lifecycle patterns.
- [`Plugin.registerExtensions`](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerExtensions) documents extension-to-view routing.
- [`FileView.onLoadFile`](https://docs.obsidian.md/Reference/TypeScript+API/FileView/onLoadFile) is a relevant lifecycle reference; verify its exact signature against the pinned local declaration.
- [HTML elements](https://docs.obsidian.md/Plugins/User+interface/HTML+elements) documents `HTMLElement.createEl()`; R4 Step 1 uses this existing host helper to build labeled controls. The pinned `obsidian@1.13.1` declaration exposes it as `Node.createEl` in `obsidian.d.ts` (no `@since` annotation on that symbol).

These references support the custom file view and its DOM construction rather than relying on Bases. They do not by themselves prove the entire `.tablify` write, rename, multi-pane, or mobile lifecycle.

## 4. Evidence protocol for future implementation

For each future R-phase implementation task:

1. Read the task’s phase guide and record the exact allowed file fence.
2. Before an API-dependent change, cite the declaration symbol and `@since` from `node_modules/obsidian/obsidian.d.ts`; link official docs.
3. If an architectural claim is uncertain, write the smallest throwaway proof first. A failing spike is evidence, not a reason to bend the experiment.
4. Add a failing behavioral test before or with the implementation; keep it in the repository.
5. Run the named gate; record the raw output or exact command/result, not an unverified summary.
6. Inspect `git diff --stat` and the full diff; verify no source/test/package files changed during a docs-only task.
7. State what is `VERIFIED`, `NOT RUN`, and `ASSUMED`; mark the next manual check.

## 5. Required claims ledger before release

Before a refactored release, update this table with observed evidence:

| Claim | Required proof | Result |
|---|---|---|
| `.tablify` extension opens the native view | Real scratch vault on minimum supported Obsidian version, Bases disabled; kit [`probes/r2-file-view/`](../probes/r2-file-view/README.md) | NOT RUN |
| Create/save/reopen preserves multi-table state | Repository round-trip test plus real app smoke | NOT RUN |
| External edits do not get silently overwritten | Fake-port tests plus real Obsidian Sync/external-edit session; probe kit verifies that a vault write notifies at all | NOT RUN |
| Linked records preserve identity through rename/delete/undo | Core property tests + UI/repository test | NOT RUN |
| CSV/TSV/XLSX interchange is accurate | Unit fixtures plus real spreadsheet app smoke | NOT RUN |
| Airtable conflict behavior remains manual and safe | Mock transport suite + scratch-base smoke | NOT RUN |
| Mobile layout/keyboard/link editor is usable | Playwright + physical phone session | NOT RUN |
| No Bases or `.tabula` runtime path ships | Source-level gate/grep with Airtable and historical exceptions | NOT RUN |

## 6. Test/build honesty for this documentation pass

Bun was unavailable in the planning workspace. No `bun run check`, test suite, layout harness, or build result is claimed here. `git diff --check` is the appropriate documentation-level validation. Future code work must run the repository gates listed in `docs/05-toolchain-and-ci.md`.

## 7. Agent stop conditions

Stop and ask the user before changing confirmed scope, migrating old data, altering plugin identity, changing release metadata, adding a runtime dependency, choosing a lossy link behavior, or making claims about FileView/write guarantees not proven by local declarations and an actual app.
