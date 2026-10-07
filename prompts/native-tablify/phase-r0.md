# R0 — Contract and documentation alignment

**Guide:** `docs/R0-contract-and-docs.md`
**Mode:** documentation only. No application code, tests, styles, package/manifest/version files, assets, or vault data.

Read `AGENTS.md`, `docs/08-decisions.md`, the master plan, R0 guide, active docs/prompts, and the historical release files named by the guide.

## Task

Bring active documentation and prompts into agreement with the confirmed native `.tablify` target while preserving the truth of the current Bases-backed `0.1.0` release and its historical records.

## Required output before editing

1. List the exact Markdown files in the allowed documentation fence.
2. Identify current-vs-target wording that must change.
3. Identify historical/prototype files that should receive a superseded/historical banner only, not be rewritten.
4. Confirm `manifest.json`, `package.json`, `CHANGELOG.md`, `PROGRESS.md`, code, and release assets will remain untouched.

Wait for explicit approval if anything falls outside the docs-only fence. When authorized, update only the listed docs/prompts and banners. Do not decide open schema/UX questions silently.

## Acceptance

- Current `0.1.0` remains Bases-backed; `.tablify` is clearly planned, not shipped.
- User-confirmed scope is consistent across active docs/prompts.
- Old `step-01`–`step-28` prompts are visibly archived and not active instructions.
- Historical changelog/progress/test evidence is preserved.
- R0 checklists reflect only work actually completed.
- Internal links resolve; `git diff --check` passes; no source/package/release changes.
- Report tests/build gates as `NOT RUN` unless actually executed.
