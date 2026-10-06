# 11 — Prompting guide for the native refactor

This guide turns the R0–R6 documents into small, verifiable work prompts. **Current mode is plan-only:** document planning is authorized; application implementation is not. The phase guides describe future implementation tasks but do not grant permission to execute them.

## 1. Context hierarchy

For every task, supply the smallest authoritative context set:

| Task | Read first |
|---|---|
| Any repository task | `AGENTS.md`, latest user scope, `docs/08-decisions.md` |
| Format/schema | `docs/03-data-model-and-migration.md`, R1 guide, actual current `src/core/types.ts` as legacy evidence |
| FileView/storage | R2 guide, `docs/02-architecture.md`, pinned `obsidian.d.ts`, official Obsidian view docs |
| Core identity/ops | R3 guide, `src/core/ops/**`, query/store contracts, current tests |
| Grid/links | R4 guide, `docs/01-spec.md`, `docs/04-design-system-and-layout.md`, layout harness |
| Import/export/sync | R5 guide, `src/core/import/**`, export/sync ports, `docs/09-publishing.md` |
| Removal/release | R6 guide, current `package.json`, release workflow, `docs/manual-test-log.md` |
| Any claim | `docs/10-verification-and-ai-hygiene.md` |

Never use the archived Bases-first prompt pack or prototype as authority for the new storage model. Historical code may be inspected to preserve current grid behavior, but it does not override the confirmed target contract.

## 2. Plan-first task template

Use this template for a future implementation task only after the user authorizes code:

```text
Project: Tablify, an Obsidian plugin planned to use native `.tablify` JSON files.
Current release is 0.1.0 and remains Bases-backed; do not describe target behavior as shipped.
Governing docs: AGENTS.md, docs/08-decisions.md, relevant R-phase guide.

Task: <one outcome from one R-phase guide>.

Plan only first. Do not edit files yet. Return:
1. exact files to read and exact files you propose to modify;
2. interface/state changes, no implementation bodies;
3. tests and measurable acceptance criteria;
4. confirmed decisions used and unresolved assumptions;
5. Obsidian APIs cited from pinned local typings and official docs, if any;
6. the three most likely failure modes.

Wait for approval. Until a separate implementation instruction is given, do not write source code.
```

## 3. Documentation-only task template

```text
Task: update documentation for <one scope>.
Mode: docs only. Do not modify src/**, tests/**, CSS, package/manifest/version files,
lockfiles, release assets, or vault data.

Read: exact docs plus the current source files needed to verify factual claims.
Deliver: exact Markdown files to change and why.
Before editing: list any unresolved product or design question. Do not decide it silently.
After editing: check internal links and `git diff --check`; report changed files and any
claims that remain assumed or NOT RUN. Do not claim app tests passed if none were run.
```

## 4. Scope and review discipline

- One goal per task; break each phase guide into small tasks before implementation.
- Explicitly fence files. For a documentation-only task, include only the named docs/prompts and never “clean up” code or release metadata.
- Check `git diff --stat` before opening individual hunks. Any out-of-fence file requires explanation and reversal or user approval.
- A recommendation in a guide is not a settled decision. Ask before implementing cardinality, deletion, migration, file-conflict, or release changes marked open in `docs/08-decisions.md`.
- Keep changes reversible and incremental. Do not combine schema, storage, grid, import, and sync in one large patch.

## 5. Verification requirements

For documentation:

- `git diff --check` passes;
- Markdown links resolve or are intentionally external;
- current `0.1.0` and future target are clearly distinguished;
- confirmed requirements are represented without expanding scope;
- historical claims are preserved or corrected with evidence;
- source/build tests are reported as not run unless they actually ran.

For future code after authorization:

- use `bun run check` and `bun run test:layout` as applicable;
- add tests for parser, repository, operations, links, import/export, and sync;
- verify FileView APIs from local declarations and a real supported Obsidian app;
- complete desktop and physical-phone gates before a release is called verified.

Always report `VERIFIED`, `ASSUMED`, `OPEN`, and `NOT RUN` separately.

## 6. Product drift checks

Reject a proposed task if it:

- adds Bases mode/fallback, `.base` migration, `.tabula` support/migration, or Markdown-note rows to the target;
- removes Airtable manual pull/push/conflict review;
- defers linked records or adds formulas/lookups/rollups without a new user decision;
- embeds attachment bytes;
- assumes old data migration is needed;
- changes plugin ID or reuses tag `0.1.0`;
- claims the target has shipped before a code/release cutover.

## 7. Adversarial review prompt

After a phase’s future implementation is authorized and completed, use a separate reviewer/model:

```text
Review the R-phase change as if you did not write it. Find the three highest-risk
ways it can lose/corrupt data or mislead a user. For each, cite file/line, an exact
scenario, and the cheapest failing test or manual experiment. Check: malformed JSON,
external writes, undo/revision races, broken links, large imports, mobile file-view
lifecycle, secrets, and old-format assumptions. Do not list strengths or fix anything.
End with what is still NOT RUN.
```
