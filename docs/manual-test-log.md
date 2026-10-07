# Manual test log

This file records checks that require real Obsidian, real devices, or real spreadsheet/Airtable clients. A browser harness does not prove these behaviors. Never change `NOT RUN` to “pass” based on a neighboring automated test.

## Current test status

The `0.1.0` GitHub prerelease exists for personal/device testing. It remains Bases-backed and was not verified in a real Obsidian vault or on a physical phone according to the rows below. Keep the historical result as recorded; the existence of the release tag does not turn an unrun manual test into a pass.

---

## Template — release vX.Y.Z

**Tested:** YYYY-MM-DD · **Build SHA:** `<commit>` · **Plugin:** vX.Y.Z · **Obsidian:** `<version>`

| Device | OS | Obsidian | Result | Notes |
|---|---|---|---|---|
| Desktop (record model/device) | OS/version | version | NOT RUN | |
| Physical phone (record model) | OS/version | version | NOT RUN | |
| Optional tablet | OS/version | version | NOT RUN | |

| Check | Result | Notes |
|---|---|---|
| Install from release into a clean vault; enable, disable, reload | NOT RUN | |
| Create/open database file; close and reopen; verify values persist | NOT RUN | |
| Two panes on the same file; external modify/rename handling | NOT RUN | |
| Multiple tables and saved views; switch while keyboard/focus is active | NOT RUN | |
| Linked records; target rename, delete, undo, and broken-reference behavior | NOT RUN | |
| Mobile keyboard open/close, active cell visibility, no layout collapse | NOT RUN | |
| Long-press context menu does not steal normal scroll | NOT RUN | |
| Safe-area/notch/home indicator; input zoom; toolbar clipping | NOT RUN | |
| Real CSV/TSV/XLSX import preview and actual row/field counts | NOT RUN | |
| Export selected range/view/table and open it in Excel/Sheets-compatible app | NOT RUN | |
| Airtable pull/push and deliberate conflict on a scratch/test base, if available | NOT RUN | |
| Token absent from database file, settings, link state, logs, and export | NOT RUN | |
| Confirm pre-existing `.base`, Markdown, and `.tabula` files were not rewritten or migrated | NOT RUN | |
| Screen-reader navigation, reading, link labels, and write announcement | NOT RUN | |

---

## v0.1.0 — Bases-backed prerelease (historical results)

**Status: NOT RUN for real-app/device checks.** The `0.1.0` GitHub prerelease/tag exists and was prepared as a device-test build. This section records the gap honestly: the release was published as a prerelease before the manual matrix was completed; it was not submitted to the community directory. Automated browser/jsdom coverage does not replace the checks below.

| Device | OS | Obsidian | Result | Notes |
|---|---|---|---|---|
| iPhone 15 | iOS 19.x | 1.14.x | **NOT RUN** | Real device check required. |
| Pixel 8 | Android 16 | 1.14.x | **NOT RUN** | Real device check required. |
| MacBook (Electron) | macOS 26 | 1.14.x | **NOT RUN** | Real vault check required. |
| Windows laptop | Windows 12 | 1.14.x | **NOT RUN** | Real vault check required. |

| Check | Result | Notes |
|---|---|---|
| Keyboard open/close while editing | **NOT RUN** | Harness simulates geometry only. |
| Long-press context menu versus scroll | **NOT RUN** | Synthetic pointer tests are not a real thumb/OS gesture. |
| Safe-area insets and iOS input zoom | **NOT RUN** | Browser declarations do not prove device behavior. |
| Real Excel/Sheets clipboard paste and spreadsheet round-trip | **NOT RUN** | Fixtures do not replace the target apps. |
| Real `.xlsx` import and exported workbook opened in a spreadsheet app | **NOT RUN** | Unit buffers are not a real client check. |
| `.tabula` migration/rollback on a real file | **NOT RUN** | Historical 0.1.0-only check; it is not part of the new product. |
| Airtable pull and deliberate conflict in a real base | **NOT RUN** | Mock transport tests are not a live smoke check. |
| Two panes on the same Bases view | **NOT RUN** | Real Obsidian panes are required. |
| Screen-reader navigation/reading/editing | **NOT RUN** | Automated roles are not a screen-reader session. |

The `0.1.0` feature and release history remain in `CHANGELOG.md`/`PROGRESS.md`. This manual log does not claim the future `.tablify` format was part of that release.

---

## R2 — FileView probe kit (checkpoint, not a release)

**Status: NOT RUN.** The kit is [`probes/r2-file-view/`](../probes/r2-file-view/README.md). It answers
ADR-0010's question (which FileView APIs exist and work at the floor version — on desktop **and** on
the phone, two rows or none) and half of ADR-0005 (whether a vault write notifies). Paste the kit's
`R2-probe-log.md` here with the app version. Do not mark a row from `obsidian.d.ts` alone: the
typings state `@since`, the app states whether it works.

| Device | OS | Obsidian (apiVersion) | Result | Notes |
|---|---|---|---|---|
| Desktop (record model/OS) | | | NOT RUN | |
| Physical phone (record model/OS) | | | NOT RUN | Desktop evidence never speaks for mobile (ADR-0010). |

| Probe check | Result | Notes |
|---|---|---|
| `registerView` + `registerExtensions` route `.tablify` to the probe view (opens as a view, not text) | NOT RUN | |
| Lifecycle: `onLoadFile` / `onUnloadFile` fire on open/close; `onRename` fires on rename | NOT RUN | |
| The view can read the file through the vault API and parse the document | NOT RUN | |
| A write through `vault.modify` produces a `modify` event | NOT RUN | Signature verified in the typings; notification not. |
| Second leaf on the same file opens without interference | NOT RUN | Seam for R2 step 5 (multi-pane). |
| Disable/close leaves no detached leaf and no error | NOT RUN | |
| `getState` / `setState` round-trip the view state | NOT RUN | Seam for R2 step 7 (workspace state). |

---

## First native `.tablify` release — template, not yet run

**Status: NOT RUN.** Do not fill this section until a refactored build exists and is installed from its own release. Record exact build SHA, Obsidian version, device, operating system, and the name of the tested file fixture.

| Check | Result | Notes |
|---|---|---|
| File extension opens custom Tablify view with Obsidian Bases disabled | NOT RUN | Verify on minimum supported app version. |
| Create, save, close, reopen a database with at least three tables | NOT RUN | Verify stable IDs and exact values. |
| Two panes share/reconcile writes; external revision never silently overwritten | NOT RUN | Include Obsidian Sync or an external text edit. |
| Create/edit/link rows across two tables; rename target; delete/undo per approved ADR | NOT RUN | Verify reference integrity. |
| Table/view switch; saved query/presentation survives reopen | NOT RUN | Include filter/sort/group and column layout. |
| CSV/TSV/XLSX import, append, replace confirmation, and undo | NOT RUN | Use known fixture and record exact counts. |
| CSV/TSV/XLSX export opened in real spreadsheet client | NOT RUN | Formula-shaped values remain literal. |
| Manual Airtable pull/push/conflict review on a scratch base | NOT RUN | If credentials/base unavailable, record NOT RUN. |
| Old `.base`, Markdown, `.tabula` data remains untouched; no migration promise | NOT RUN | Compare before/after hashes or copies. |
| Mobile keyboard, safe area, long-press, selection, and screen reader | NOT RUN | Record actual hardware/app behavior. |

A release is not described as verified while any required row is blank or `NOT RUN`.
