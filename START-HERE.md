# Start here — native `.tablify` refactor docs

> **Plan-only status:** these documents describe the user-approved target and a phased plan. The current `0.1.0` release remains Bases-backed. This file does not authorize application code changes.

## What this repository currently is

At the audited commit, the plugin id is `tablify`, tag `0.1.0` exists as a GitHub prerelease, and the runtime view still uses Obsidian Bases and Markdown-note properties. There is no native `.tablify` database-file implementation yet. The `.tablify/` vault-root directory stores sync metadata, not database contents. Real desktop/phone verification for `0.1.0` remains `NOT RUN`.

## What the refactor is planned to become

One versioned JSON `.tablify` file contains multiple tables and saved views. Linked records ship in the first stable release; formulas/lookups/rollups are deferred. Attachment fields reference vault paths. CSV/TSV/XLSX import/export and manual Airtable pull/push with conflict review stay in scope. Obsidian Bases and `.tabula` support/migration are removed; no migration from existing Bases data is assumed.

## Read in this order

1. [`AGENTS.md`](AGENTS.md) — repository rules and plan-only fence.
2. [`docs/08-decisions.md`](docs/08-decisions.md) — confirmed product decisions and open ADRs.
3. [`docs/reference/REFACTOR-PLAN.md`](docs/reference/REFACTOR-PLAN.md) — audit and master plan.
4. [`docs/reference/native-tablify/README.md`](docs/reference/native-tablify/README.md) — guide index and phase dependencies.
5. `docs/01-spec.md` through `docs/07-test-plan.md` — target product/architecture/model/UI/toolchain/roadmap/test contracts.
6. The relevant R-phase guide and its `prompts/native-tablify/phase-rN.md` planning prompt.
7. `docs/10-verification-and-ai-hygiene.md` before making API, release, or test claims.

## How to work with the phase guides

- One phase and one small step at a time. The guide gives the full dependency map; do not implement a whole phase in one change.
- Plan first; list exact files, interfaces, tests, assumptions, and stop conditions; wait for approval.
- In the current mode, only requested documentation may change. No `src/**`, tests, styles, package/manifest, versions, release assets, or vault data.
- If a guide labels a decision “proposed” or “open,” do not silently treat it as settled. Record an ADR or ask the user.
- After documentation changes, check links and `git diff --check`. Do not say source tests passed unless they were run.

## Next planning prompt

R0 documentation alignment is complete; its checklist is marked in `docs/reference/native-tablify/R0-contract-and-docs.md`. If continuing the plan, read `prompts/00-session-anchor.md` and use `prompts/native-tablify/phase-r1.md` for schema/interface/test planning. That is still plan-only: no source implementation is authorized. Revisit R0 only if the confirmed product scope or active docs change.
