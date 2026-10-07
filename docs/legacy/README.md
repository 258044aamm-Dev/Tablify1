# docs/legacy — the frozen record of the Bases-backed product

**Status: frozen. Read-only. Do not implement from anything in this directory.**

This directory holds the historical record of the **previous** product — the `0.1.0` Obsidian plugin whose grid
was an Obsidian **Bases** view over Markdown notes and their frontmatter — together with the planning material
that produced it: the build log, the design record and plans, the frozen reference prototype, the throwaway
Bases probe, and the archived prompt set.

Nothing here is a specification for future work. Where anything in here and the live docs disagree, the live
docs win.

## What is in here

| Path | What it was |
|---|---|
| `PROGRESS.md` | The 2,446-line step log of the 29 build steps (M0–M6), including the findings worth keeping and the open questions that were live at the time. |
| `DESIGN-REVIEW.md`, `PLAN-ui-ux-pass.md`, `PLAN-style-audit-notes` | The design review and the UI/UX and style plans produced from it. |
| `PROCEED-ASSUMPTION-2026-10-05.md` | The dated assumption record that authorized the prototype-first start. |
| `PROTOTYPE-FREEZE.md` | The freeze declaration for `prototype/`. |
| `prototype/` | The frozen HTML/CSS/JS reference prototype (~9.6k lines) the grid's interaction model was specified against. Reference material for humans; no module may import from it. |
| `spike/bases-path/` | The throwaway probe (step 10) that established what the Bases data path could and could not do. Superseded by the verified facts folded into the live architecture doc. |
| `archive/bases-first-prompts-2026-10/` | The 29 numbered step prompts that built the Bases-backed product. |

## What is deliberately NOT here

Two things that look historical are **live** and stay in the active tree:

- **`docs/01-spec.md` … `docs/12-agent-prompt-pack.md`, `docs/REFACTOR-PLAN.md`, `docs/manual-test-log.md`** —
  R0 rewrote the twelve numbered docs as the **native `.tablify` target contract** (spec, architecture, data
  model, design system, toolchain, roadmap, test plan, decisions, publishing, verification hygiene, prompting
  guide, prompt pack). The R0–R6 guides cite them as their normative base, `docs/08-decisions.md` is the ADR
  ledger the phases depend on, `docs/manual-test-log.md` carries the template R6 fills in, and
  `tests/unit/keyboard-table.test.ts` reads `docs/01-spec.md` at runtime. They were briefly moved here in error
  and restored in the same change that created this directory.
- **`prompts/**` and `START-HERE.md`** — the live R0–R6 phase prompts, the `reuse-*` prompts and the native
  plan's onboarding brief. The *Bases-era* prompts are the ones in `archive/`, which are frozen here.

## Where the live contract is

| Live path | What it is |
|---|---|
| [`../README.md`](../README.md) | Index of the R0–R6 guide set (native `.tablify` refactor). |
| [`../REFACTOR-PLAN.md`](../REFACTOR-PLAN.md) | The audit and master plan for the refactor. |
| `../01-spec.md` … `../12-agent-prompt-pack.md` | The normative target contract. |
| [`../../AGENTS.md`](../../AGENTS.md) | Repository rules, source-of-truth order, and the plan-only fence. |
| [`../../prompts/native-tablify/`](../../prompts/native-tablify/) | The live phase prompts for R0–R6. |

## Verify before quoting

Some status text in these documents was true when written and can go stale — for example several records here (and some live docs
written during the Bases era) state that tag/release `0.1.0` exists. Check the repository's actual
tags and releases before relying on any such claim. (Observed 2026-10-07: no tags and no releases were present
on GitHub.)

## Reading rule

1. Do not edit files in this directory. They are the record, not the plan.
2. Do not copy behaviour out of them into the native implementation without checking the live doc for that
   area — several of these contracts deliberately changed (storage, identity, row creation, `.tabula` support,
   Bases integration).
3. Do not cite them as current requirements. Cite `docs/` or `AGENTS.md`.
