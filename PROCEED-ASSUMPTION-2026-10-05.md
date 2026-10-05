# Proceed-as-assumption — 2026-10-05

The user's message contained **"3-10"** plus *"Settings > Advanced Settings → Content, I want all content
to be enabled by default"*, and the standing **"Proceed and execute"** / *"the new modification shouldn't
influence other existing features and functionalities"*.

Three clarifying questions were asked (meaning of "3-10"; which surface the settings belong to; what the
Content group should contain). **All three came back skipped.** Per the standing instruction, the turn
proceeded on the most defensible reading, and this file is the record of it.

## The reading that was executed

1. **"3-10" = continue the approved, stage-gated plan.** `PLAN-ui-ux-pass.md` was approved with stages 0–7;
   "3-10" is read as *carry on from where the record stops* (Stage 2 was the last closed stage, with the
   plan's Stage 3—type, icons, wordmark—next). It is **not** read as a different document's numbering:
   `prototype/AUDIT-REPORT.md` §9 and `docs/03`–`docs/10` were both checked, and neither contains a
   "3-10" list that the wording matches better.
2. **The settings request is explicit, so it executes first**, as an *unnumbered* stage between Stage 2
   and Stage 3 (the plan has no such stage; inventing it as "Stage 2.5" would have renumbered the
   approved stages, so it is named rather than numbered — the same way the persistence work was).
3. **The surface is the prototype's own Settings tab** (`prototype/js/settings.js`, the tabstrip's
   "Settings" screen). The request was phrased as a UI change to the thing being built, and every
   feature in the prototype exists on the screens the user has been reviewing.
4. **"Content" = the view's own content**, i.e. the things a view *shows* that are not the data: the
   toolbar, the status bar, the row gutter's numbers and checkboxes, the group headers, and the summary
   row. All five default to **on**, and each one really hides its content. Missing from the list on
   purpose: field visibility (already `Fields` / Hide fields per view) and the frozen primary column
   (already a View setting, and the mobile rule of batch 8 governs it).

## What would invalidate this reading, and how cheap the pivot is

| if "3-10" actually meant | the pivot |
| --- | --- |
| §9 of `AUDIT-REPORT.md` (checks 3–10) | run those checks and report them — no code change |
| `docs/03`–`docs/10` (the spec chapters) | re-read those chapters against the prototype and list the gaps — no code change |
| a different stage list entirely | say so and re-plan; the stage-gated execution is unchanged |

| if the Content group was meant elsewhere | the pivot |
| --- | --- |
| the **real plugin's** Settings → Advanced | the five keys are already written to be lifted: `settings.js`'s row builder, `store.js`'s defaults with the `load()` backfill, and this table are the whole surface. `docs/` gains the section in the same shape at the next spec pass |
| a different set of switches | each switch is one `rowOf(name, toggle(...), desc)` call plus one gate; adding or removing one is a five-line edit and the audit check names the five it expects |

## Housekeeping recorded in the same file

Three files that earlier notes described as written were **not on disk** when this stage started
(`PROTOTYPE-FREEZE.md`, `PLAN-style-audit-notes`, and this file), and the audit's persistence checks
(73–76 in those notes) were likewise absent while the suite on disk reported 72 checks and every doc
agreed with 72. The work was therefore redone and re-verified rather than assumed: the three files are
restored above, and the persistence checks now exist as **75–78**, measured against a real `page.reload()`
(the numbers in `DESIGN-REVIEW.md`, `AUDIT-REPORT.md` and `tests/README.md` now all say **78**).
