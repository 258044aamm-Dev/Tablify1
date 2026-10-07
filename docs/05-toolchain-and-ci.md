# 05 — Toolchain, CI, and implementation gates

> **Status:** this records the current repository toolchain and the gates future `.tablify` implementation must preserve. It does not by itself authorize package/source changes; R1–R5 implement against these gates under the standing authorization recorded in [`08-decisions.md`](08-decisions.md) §Implementation authorization log.

## Current toolchain (source of truth: `package.json`, `bun.lock`, CI)

- Bun `1.4.2` in CI; `bun.lock` is the lockfile.
- TypeScript 5.8.3 with strict checking; esbuild 0.25.5 emits the Obsidian plugin bundle.
- ESLint 9 flat config with `eslint-plugin-obsidianmd`, `typescript-eslint`, project boundaries, brand/manifest checks, formatting, and CSS/contrast gates.
- React 19.3.0 and React DOM for the grid; `read-excel-file` 9.3.10 and `write-excel-file` 4.1.1 for spreadsheet interchange.
- `obsidian` typings pinned at 1.13.1; the current manifest minimum is 1.13.0. The target FileView API and lifecycle must be verified against these declarations and the app version actually selected for release.
- Vitest 3.2.7, jsdom 29.1.1, and Playwright 1.63.0 for unit/DOM/layout work.

Do not blindly copy example package/config snippets from older documents. `package.json`, `bun.lock`, `tsconfig.json`, `eslint.config.mts`, and `.github/workflows/ci.yml` in the audited checkout are the actual current configuration.

## Commands

```bash
bun install --frozen-lockfile
bun run check          # typecheck, lint, brand/manifest checks, format, tests, build, contrast, CSS gate, size
bun run test:layout    # browser harness (CI runs this after installing Chromium)
bun run dev            # esbuild watch
bun run build          # build plugin bundle
```

`bun run check` is the minimum code gate. CI also runs the layout harness. A documentation-only task should run `git diff --check`; do not claim TypeScript/tests/build passed unless the commands ran.

## Architectural import boundaries

Retain and extend current lint-enforced boundaries:

```text
src/core/**       pure TypeScript; no Obsidian, React, DOM, file I/O, or network
src/grid/**       React UI; no adapter-specific imports or direct storage writes
src/adapters/**   persistence/file adapters; no React
src/sync/**       provider/transport logic; no React; explicit user-triggered composition
src/plugin/**     Obsidian workspace/file-view/settings composition
```

The future database repository belongs at the adapter/host boundary. The database model, schema migrations, ID rules, query, and operations stay in core. The custom `FileView` is plugin glue. Sync cannot mutate the grid or bypass repository operations.

## R2 API verification gate

Before relying on a FileView API:

1. Inspect the exact symbol and `@since` tag in pinned `node_modules/obsidian/obsidian.d.ts`.
2. Link the corresponding official Obsidian reference (custom views, `registerExtensions`, file-view lifecycle).
3. Build a minimal throwaway proof in a scratch vault for extension routing, load/unload, rename, modify notification, and supported write API.
4. Run that proof on the intended minimum desktop and mobile Obsidian versions.
5. Record verified output and remaining assumptions in `docs/10-verification-and-ai-hygiene.md`.

Do not infer write atomicity from a method name. Do not lower `minAppVersion` just because Bases is removed.

## New test/gate work (future implementation)

- Add parser/serializer/versioning/link fixtures and test suites to the existing Vitest project.
- Add fake file-port/repository tests, multi-pane/external-modify state tests, and link integrity tests.
- Extend the existing browser harness with multi-table and linked-record fixtures.
- Preserve bundle, contrast, CSS, brand, manifest, formatting, and architecture checks.
- Add a source gate rejecting Bases runtime APIs and `.tabula` modes after the cutover. Allow Airtable’s remote `baseId` terminology, historical release logs, and explicit negative tests.
- Do not add a JSON/database dependency merely to serialize plain JSON. Any runtime dependency requires an ADR with measured bundle and mobile impact.

## Bundle/performance policy

Keep current bundle budgets and measure dependencies with the existing bundle-size script. Existing grid targets (5,000-row view and responsive layout) are baselines, not evidence that full-document JSON writes will be cheap. Benchmark parse/open, query, serialize/write, and large import separately before setting write/file-size limits.

## Release boundary

The current `0.1.0` manifest/package description matches the current Bases-backed release and should remain unchanged until the refactor code ships. At cutover, update version/description/README/changelog together, preserve tag `0.1.0`, and publish a distinct prerelease only after automated and manual verification. Never modify `main.js` or release assets as part of a docs-only task.
