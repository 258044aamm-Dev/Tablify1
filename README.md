# Tablify

> **Release status:** the current `0.1.0` GitHub prerelease is a Bases-backed testing build. It is not in the community directory, and real-app/device checks remain `NOT RUN` in `docs/manual-test-log.md`.
>
> **Planned direction:** Tablify is being planned as an Obsidian plugin centered on a versioned, multi-table `.tablify` JSON database, with no Bases integration or old-data migration. That refactor is **not implemented in `0.1.0`**. See [`docs/REFACTOR-PLAN.md`](docs/REFACTOR-PLAN.md) and the [R0–R6 guides](docs/README.md).

This README’s feature description below is retained as a description of the current `0.1.0` prerelease, not the planned native format.

Tablify is currently a spreadsheet-class grid view for Obsidian Bases: rows are notes, columns are their properties, and the grid behaves like a spreadsheet.

![The current 0.1.0 grid, with a range selected](docs/images/desktop-light.png)

## Install the current prerelease

The `0.1.0` prerelease was published for personal/device testing and has not been submitted to the community directory. The device-verification matrix remains `NOT RUN`; install only into a test vault.

### Manually, from the release

1. Download `main.js`, `manifest.json`, and `styles.css` from the [release](https://github.com/258044aamm-Dev/Tablify/releases/tag/0.1.0).
2. Put them in `<your test vault>/.obsidian/plugins/tablify/` (the folder matches the manifest id).
3. In Obsidian, reload installed plugins and enable Tablify. The current prerelease uses Bases; the core plugin must be enabled to open its grid.

### From a clone, for development

```bash
bun install --frozen-lockfile
bun run build
bun run check
bun run test:layout
```

See `AGENTS.md` and `docs/05-toolchain-and-ci.md` for the current repository gates.

## What the current 0.1.0 build does

- **Grid rendering:** virtualized rows, sticky header, pinning only when the pane is at least 600 px wide, row heights/density, column resize/reorder, row reorder, and grouping.
- **Selection/clipboard:** cells, ranges, rows, columns, select-all; copy as TSV and HTML; paste TSV/HTML; cut and clear.
- **Editing and bulk operations:** type-specific editors, fill down/right, bulk column edit, insert/duplicate/delete rows, and undo/redo.
- **Import:** CSV, TSV, and XLSX preview followed by note creation. The old `.tabula` option is legacy/unavailable as a writer.
- **Export:** TSV and XLSX from the selection or view. The current release does not add a CSV exporter.
- **Views:** Bases supplies filters, sorts, grouping, formulas, and `.base` view configuration; Tablify adds grid presentation.
- **Airtable:** optional manual pull/push with field-by-field conflict review. The token is stored through Obsidian `SecretStorage`; remote schema changes are not made.

These features describe the existing code only. The native refactor will replace note-backed storage and these Bases dependencies rather than preserve them as a fallback.

## Current release network use

The current build works locally/offline. Network access is for explicit Airtable sync operations only. Tablify has no telemetry or analytics; token storage and endpoints are described in the 0.1.0 release’s docs. Future release copy must be rechecked against the implemented client.

## Planned native-format scope

The target product is one versioned `.tablify` JSON file containing multiple tables and saved views. It will support linked records, CSV/TSV/XLSX import/export, manual Airtable pull/push with conflict review, and attachment path references. Formulas/lookups/rollups are deferred. Obsidian Bases and `.tabula` are not compatibility modes, and no `.base` or `.tabula` migration is planned. The R0–R6 guide set contains the detailed plan; none of these target features are available in `0.1.0`.

## Current keyboard reference

| Keys | Current 0.1.0 behavior |
|---|---|
| Arrow keys (Shift to extend) | Move active cell / extend selection |
| Home / End / PageUp / PageDown / Ctrl+Home / Ctrl+End | Navigate visible band or table edges |
| Enter / F2 | Edit active cell |
| Tab / Shift+Tab | Commit and move right / left |
| Printable key | Start replacing the active cell |
| Space on checkbox | Toggle value |
| Cmd/Ctrl+C / X / V | Copy, cut, paste selection |
| Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z / Ctrl+Y | Undo / redo |
| Cmd/Ctrl+A | Select all in current view |
| Cmd/Ctrl+Enter | Bulk edit active column |
| Delete / Backspace | Clear selection |
| Alt+D / Alt+R | Fill down / fill right |
| Escape | Cancel edit or clear selection |

## License and attribution

MIT — see [LICENSE](LICENSE) and [NOTICE](NOTICE). Tablify is not affiliated with, endorsed by, or sponsored by Obsidian or Airtable. Historical provenance is retained in the legal notices; it is not a promise of `.tabula` compatibility in the planned native release.
