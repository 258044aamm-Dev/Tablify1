# Tablify

> **Starting the build? Open [`START-HERE.md`](START-HERE.md) — paste-ready prompts, one per milestone, with the pre-flight checklist.**

A spreadsheet-class grid for [Obsidian Bases](https://help.obsidian.md/bases). Rows are notes, columns are properties, and the grid behaves like a real spreadsheet — range selection, block paste, keyboard navigation, bulk edit, undo/redo — with optional one-way Airtable sync.

> **Status: specification.** This repository currently contains the design documents only. Code follows the roadmap in `docs/06-roadmap.md`.

---

## Why this exists

Obsidian's built-in Bases table view is a *view*. It is not a spreadsheet: it has no range selection, no block clipboard, no fill, no keyboard-first navigation model, and no way to move data in bulk between itself and Excel/Sheets/Airtable. Tablify is the grid those workflows need, built on Bases' own data model instead of competing with it.

The plugin is the successor to `airtable-tabula` (a fork of `MehulG/airtable-tabula`). See `docs/08-decisions.md` for why the product pivoted and what was carried over.

## Read in this order

| Doc | What it settles |
|---|---|
| [`docs/01-spec.md`](docs/01-spec.md) | What the plugin does, for whom, and what it deliberately does not do |
| [`docs/02-architecture.md`](docs/02-architecture.md) | Layers, ports and adapters, module contracts, write queue, performance budget |
| [`docs/03-data-model-and-migration.md`](docs/03-data-model-and-migration.md) | Frontmatter mapping for every field type, sync state, the `.tabula` legacy adapter and one-way importer |
| [`docs/04-design-system-and-layout.md`](docs/04-design-system-and-layout.md) | Token tiers, brand layer, the single layout contract, mobile keyboard handling, accessibility |
| [`docs/05-toolchain-and-ci.md`](docs/05-toolchain-and-ci.md) | Bun + esbuild + TypeScript strict + ESLint 9 + Prettier + Vitest + Playwright + GitHub Actions |
| [`docs/06-roadmap.md`](docs/06-roadmap.md) | Phases M0–M6 with acceptance criteria and full-time estimates |
| [`docs/07-test-plan.md`](docs/07-test-plan.md) | Test tiers, the layout harness, fixtures and golden files |
| [`docs/08-decisions.md`](docs/08-decisions.md) | Decision log (ADRs), open questions, risk register |
| [`docs/09-publishing.md`](docs/09-publishing.md) | Release artifacts, `community.obsidian.md` submission, network-use disclosure |
| [`docs/10-verification-and-ai-hygiene.md`](docs/10-verification-and-ai-hygiene.md) | How to verify AI output: claim ledger, deterministic gates, agent red flags, per-milestone audit |
| [`docs/11-prompting-guide.md`](docs/11-prompting-guide.md) | How to prompt for exact, verifiable results: levers, prompt anatomy, anti-patterns, diagnostics |
| [`docs/12-agent-prompt-pack.md`](docs/12-agent-prompt-pack.md) | Ready-to-paste prompts for the session anchor, every milestone M0–M6, and reusable review/bug/spike/handoff prompts |

`AGENTS.md` is written for the coding agent that implements this — boundaries, commands, conventions, and a never-do list.

## Non-negotiables

1. **No theme fights.** Obsidian CSS variables drive structure and surfaces; brand tokens only add accent, selection and status colour. Zero `!important`.
2. **No custom height chains.** The grid fills whatever container Obsidian gives it. No `ResizeObserver`-anchored percentage chains, ever again.
3. **No Obsidian API re-invention.** `Modal`, `Scope`, `registerDomEvent`, `SecretStorage` — not hand-rolled overlays and `window.addEventListener`.
4. **The core is pure.** `src/core/**` imports neither `obsidian` nor React, and a lint rule enforces it.
5. **Every fix ships with a test.** A layout bug without a harness case is a bug scheduled to return.
