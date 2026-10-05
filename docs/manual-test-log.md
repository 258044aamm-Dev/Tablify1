# Manual test log

One section per release. Everything here is on **real hardware** — the tier-5 checks that cannot be automated (`docs/07-test-plan.md`).

Copy the block below for each release and fill it in. A release is not ready to tag while any row is blank.

---

## Template — vX.Y.Z

**Tested:** YYYY-MM-DD · **Build:** `main.js` from release/vX.Y.Z · **Plugin:** vX.Y.Z

| Device | OS | Obsidian | Result | Notes |
|---|---|---|---|---|
| iPhone 15 | iOS 19.x | 1.14.x | ☐ pass ☐ fail | |
| Pixel 8 | Android 16 | 1.14.x | ☐ pass ☐ fail | |
| MacBook (Safari-free: Electron) | macOS 26 | 1.14.x | ☐ pass ☐ fail | |
| Windows laptop | Windows 12 | 1.14.x | ☐ pass ☐ fail | |

| Check | Result | Notes |
|---|---|---|
| Keyboard open while editing a cell near the bottom; active cell stays visible | ☐ | |
| Keyboard open/close does not collapse the grid | ☐ | |
| Toolbar single-row, no clipped controls | ☐ | |
| Long-press opens the context menu (and does not scroll instead) | ☐ | |
| No input zoom on focus (iOS) | ☐ | |
| Safe-area insets respected (notch, home indicator) | ☐ | |
| Momentum scroll through 5,000 rows | ☐ | |
| Paste a real range from Excel (desktop) and Google Sheets (mobile app) | ☐ | |
| Copy a range out into Numbers / Excel / Sheets | ☐ | |
| Import a real `.xlsx`; preview numbers match reality | ☐ | |
| Migrate a real `.tabula` file, then roll back from the report | ☐ | |
| Airtable pull with a real base; conflict dialog on a deliberately conflicting row | ☐ | |
| Two panes on the same base: no lost edits, no stale reads | ☐ | |
| Screen reader: navigate and read the grid; announce a bulk edit | ☐ | |
