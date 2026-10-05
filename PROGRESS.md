# PROGRESS

- Milestone: M0 — Foundation                                  Branch: main
- Last completed step: **step 01 — toolchain and gate.** The repository is a buildable, lintable,
  testable plugin: `bun run check` exits 0 across typecheck → lint → format:check → test → build → size,
  and the bundle-size gate reports `main.js` 802 B raw / 532 B gzip.

- Verified (commands run, observed results):
  - `bun --version` → `1.4.2`; `node --version` → `v20.20.2`.
  - `bun install` → `437 packages installed [2.56s]`; every pinned version resolved: obsidian 1.13.1,
    typescript 5.8.3, esbuild 0.25.5, eslint 9.39.4, typescript-eslint 8.59.1,
    eslint-plugin-obsidianmd 0.4.2, @eslint/js 9.39.5, jiti 2.7.0, globals 17.13.0, prettier 3.9.9,
    vitest 3.2.7, jsdom 29.1.1, @vitest/coverage-v8 3.2.7, @types/node 20.19.43. No peer conflicts.
  - `bun run check` → exit code 0. Raw output: `tsc --noEmit` silent; `eslint .` silent;
    `prettier --check .` "All matched files use Prettier code style!"; `vitest run` 5 passed (1 file);
    `esbuild` production build silent; `bundle-size` OK.
  - `bun run size` → `main.js raw 802 bytes (0.78 KB) limit 900.00 KB`;
    `gzip 532 bytes (0.52 KB) limit 300.00 KB`; `styles.css !important check: clean`.
  - The linter is not decorative: `src/scratch.ts` containing `const a: any = 1;`, `'x' as string`,
    an inline `eslint-disable-next-line` and `1!` produced **6 errors, exit 1** — 7 problems total.
    Deleted afterwards; `bun run lint` clean again.
  - `main.js` keeps `require("obsidian")` external and is git-ignored (`git status` → 0 entries).
  - Regression, after the new root files landed: `node tools/contrast.js` → **30/30 gated pairs pass**;
    `prototype` smoke → **ALL CHECKS PASSED** (37 checks, including the 5,000-row and 29663-byte
    persistence cases); `prototype` interaction audit → **78 passed, 0 failed, 78 total**, runtime
    `page errors / console errors during the run: none`. No file under `prototype/**` changed
    (`git diff HEAD -- prototype` empty except the new `prototype/package.json`).

- Assumed / not verified (each with how to verify):
  1. `minAppVersion: "1.13.0"` in `manifest.json` — provisional. Verify in the step-10 Bases spike on a
     real vault; if `registerBasesView` works on 1.12.x, this is the number to lower.
  2. esbuild's `external: ['@codemirror/*', '@lezer/*']` patterns are untested: nothing imports them yet.
     Verify at the grid step by adding an import and re-running `bun run size`.
  3. `jsdom@29.1.1`, not 30.1.2: jsdom ≥ 30 requires Node ≥ 22.22.2 and this toolchain targets Node 20.
     Verify by running the first `tests/dom` case (step 05); revisit if the Node floor rises.
  4. `verbatimModuleSyntax: true` compiles cleanly today, with one small module. Re-verify as the code
     grows (it fails loudly, so this is low risk).
  5. Coverage thresholds are configured but not yet enforced: `check` runs `vitest run`, not
     `vitest run --coverage`. Step 05 wires enforcement.

- Half-finished: nothing. `styles.css` holds only its header comment by design; `src/core/`, `src/grid/`
  and `src/adapters/` do not exist yet, on purpose.

- Open questions for the human:
  1. `minAppVersion` — keep 1.13.0 (default) or lower it after the spike? Default: keep 1.13.0.
  2. Newer majors exist than the pack's pins (TypeScript 7.0.2, ESLint 10.12.0, Vitest 5.0.3, esbuild
     0.28.2). The pins mirror `obsidianmd/obsidian-sample-plugin`. Default: stay pinned for M0, then
     evaluate one major at a time with the gate as the arbiter.
  3. Node floor: 20 (current, forces jsdom 29) or 22.22+ (allows jsdom 30 and `@types/node` 22)?
     Default: stay on Node 20 until something needs the newer runtime.

- Scope amendments forced by the toolchain (all recorded here, none silent):
  - `manifest.json` was created in step 01 because `eslint-plugin-obsidianmd` reads it at config-load
    time and fails the whole lint run without it. Step 02 therefore *amends* it (id rules, licence,
    attribution) instead of creating it.
  - `tests/mocks/obsidian.ts` + a Vite alias: the `obsidian` package is types-only (`"main": ""`), so
    nothing can import it at runtime. TypeScript still uses the real `obsidian.d.ts`.
  - `tools/package.json` and `prototype/package.json` (`{"type":"commonjs"}`): the root `package.json` is
    ESM, which broke the existing CommonJS prototype tooling (contrast gate, smoke, audit). Scoping
    CommonJS to those two directories restored them without editing a single prototype file.
  - Two scoped lint overrides, both commented in `eslint.config.mts`: `obsidianmd/no-nodejs-modules` off
    for Node-only build tooling, and `@typescript-eslint/unbound-method` off inside `tests/**`
    (the smoke test deliberately invokes prototype methods against a synthetic receiver).

- Next step: `prompts/step-02-manifest-and-legal.md` (amends `manifest.json`; adds `LICENSE`, `NOTICE`,
  `versions.json`, the brand gate and the manifest checks; pulls the upstream copyright line from
  `../airtable-tabula/LICENSE`).

- Files touched this step: `package.json`, `bun.lock`, `tsconfig.json`, `eslint.config.mts`,
  `.prettierrc`, `.prettierignore`, `.editorconfig`, `.gitignore`, `esbuild.config.mjs`,
  `vitest.config.ts`, `styles.css`, `manifest.json`, `scripts/bundle-size.ts`, `src/plugin/main.ts`,
  `tests/unit/plugin-smoke.test.ts`, `tests/mocks/obsidian.ts`, `tools/package.json`,
  `prototype/package.json`, `PROGRESS.md`.
