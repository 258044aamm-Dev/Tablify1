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

---

## v0.1.0 — pending (step 27, 2026-10-06)

**Status: NOT RUN.** Nothing in this section has been executed. No release of this plugin has been loaded into a
real Obsidian, on real hardware, yet — step 27 is where that gap is *recorded*, not where it is closed, because the
build has never left the harness (`docs/07` §Tier 5 is the list that only a person with a phone can complete). The
rows below are the release candidates; each is filled in before `v0.1.0` is tagged, and a row is never marked pass
because a neighbouring row passed.

| Device | OS | Obsidian | Result | Notes |
|---|---|---|---|---|
| iPhone 15 | iOS 19.x | 1.14.x | **NOT RUN** | manual — needs real hardware |
| Pixel 8 | Android 16 | 1.14.x | **NOT RUN** | manual — needs real hardware |
| MacBook (Electron) | macOS 26 | 1.14.x | **NOT RUN** | manual — needs a real vault |
| Windows laptop | Windows 12 | 1.14.x | **NOT RUN** | manual — needs a real vault |

| Check | Result | Notes |
|---|---|---|
| Keyboard open while editing a cell near the bottom; active cell stays visible | **NOT RUN** | tier-4 #2 and `keyboardInset` stand in for the geometry only (`--tablify-keyboard-inset` 260 px in the `phone-keyboard` fixture); a real keyboard also *resizes* differently on each OS |
| Keyboard open/close does not collapse the grid | **NOT RUN** | no viewport-height unit exists to collapse with (`css-gate` rule 4) — but the real `visualViewport` behaviour is untested |
| Toolbar single-row, no clipped controls | **NOT RUN** | tier-4 #5 measures it in the harness at five sizes |
| Long-press opens the context menu (and does not scroll instead) | **NOT RUN** | tier-4 #23 dispatches synthetic touch pointers; a real thumb drags enough to be a scroll |
| No input zoom on focus (iOS) | **NOT RUN** | tier-4 #19 gates 16 px, which is the mechanism, not the effect |
| Safe-area insets respected (notch, home indicator) | **NOT RUN** | tier-4 #20 checks the declarations exist; the inset itself is 0 in a browser |
| Momentum scroll through 5,000 rows | **NOT RUN** | 5,000 rows render in the harness; momentum is a compositor behaviour |
| Paste a real range from Excel (desktop) and Google Sheets (mobile app) | **NOT RUN** | the clipboard flavours are covered by fixtures (`text/html` + `text/plain` TSV captured from Sheets) |
| Copy a range out into Numbers / Excel / Sheets | **NOT RUN** | round trip is covered in-harness (tier-4 #15) |
| Import a real `.xlsx`; preview numbers match reality | **NOT RUN** | `read-excel-file` is unit-tested against generated buffers; no real Excel or LibreOffice exists in the build container (recorded in step 24's report) |
| Migrate a real `.tabula` file, then roll back from the report | **NOT RUN** | seven committed fixtures; a real `.tabula` from a live vault is the missing one |
| Airtable pull with a real base; conflict dialog on a deliberately conflicting row | **NOT RUN** | the conflict review is tested against a fake transport; no live base has been read |
| Two panes on the same base: no lost edits, no stale reads | **NOT RUN** | the live-view registry is unit-tested, not two real panes |
| Screen reader: navigate and read the grid; announce a bulk edit | **NOT RUN** | the roles, names and the polite live region are asserted in `tests/dom/a11y.test.ts`; a screen reader is not in CI |

**What step 27 changed for this file:** the *checks* column stays empty on purpose. Step 27's job at the five
viewports was to make the automated tiers own as much of this matrix as they can — inputs at 16 px (#19), tap
targets at 44 × 40 (#7), scrollbars thick enough to grab with a thumb (#21), safe-area padding declared (#20), the
freeze control absent below 600 px (#22), long-press without a menu during the hold (#23) — so that a person with a
phone is confirming, not discovering. Everything this table still says **NOT RUN** is a thing no browser in this
container can truthfully claim.

---

## 0.1.0 — release verification (prepared 2026-10-06)

**The build to test is the `0.1.0` pre-release:** <https://github.com/258044aamm-Dev/Tablify/releases/tag/0.1.0>.
It is published as a **pre-release** (its own body says so) with the three assets BRAT installs from
(`main.js` 464,705 B, `manifest.json` 359 B, `styles.css` 25,056 B, all three downloaded and checked on
2026-10-06). BRAT: *Add beta plugin* → repository `258044aamm-Dev/Tablify` → pick `0.1.0`. Manual route: drop the
three files in `<vault>/.obsidian/plugins/tablify/`. Nothing else is required, and no row below is filled in by
installing it — only by using it.

**Status: NOT RUN — and this section is the reason the release is not tagged.** `docs/06-roadmap.md` §M6 says the
tag waits until *"the release is verified in-app on desktop **and** phone"*, and `docs/10` §the release checklist
has the same two rows. Neither has happened: at the time of writing, the plugin has run in the layout harness and
in jsdom, and in **no** real Obsidian. The version each row must be stamped with is `0.1.0` (the value in
`manifest.json`, `package.json` and `versions.json`).

| Step | Version | Result | Notes |
|---|---|---|---|
| Installed from the release/BRAT into a clean vault — desktop | 0.1.0 | **NOT RUN** | manual — the pre-release above; needs a real vault |
| Installed from the community directory — desktop | — | **NOT RUN** | not possible: the plugin is not submitted yet (see the prerequisite list in `PROGRESS.md` §step 28) |
| Installed from the release/BRAT into a clean vault — phone | 0.1.0 | **NOT RUN** | manual — the pre-release above; needs a real device |
| The base opened and the grid drawn | 0.1.0 | **NOT RUN** | harness equivalent: tier-4 #1–#8 at five viewports |
| A cell edited, and the note's frontmatter checked | 0.1.0 | **NOT RUN** | harness equivalent: tier-4 #10, #15 |
| An import (CSV and XLSX), preview matched against the source | 0.1.0 | **NOT RUN** | the XLSX writer/reader pair is unit-tested against generated buffers; no real Excel or LibreOffice exists in the build container (step 24's report) |
| An export, opened in a real spreadsheet | 0.1.0 | **NOT RUN** | same gap, other direction |
| A `.tabula` migration, including the rollback | 0.1.0 | **NOT RUN** | seven committed fixtures stand in for a real legacy file |
| A pull from a linked base (if a link is available) | 0.1.0 | **NOT RUN** | the engine is tested against a fake transport; no live base has been read |
| The plugin disabled and re-enabled, then the vault reopened | 0.1.0 | **NOT RUN** | no `onunload` leak can be observed outside a real app |

**What would change this section:** a person, a phone, a desktop machine and about twenty minutes. Nothing in
this repository can substitute for it, which is why the rows are empty rather than green.
