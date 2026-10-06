Task: stand up the toolchain so this repository is a buildable, lintable, testable Obsidian plugin —
and so that `bun run check` is a real gate before any product code exists.

Read first: `docs/05-toolchain-and-ci.md` (this step implements §1–§2 and §21 of it, and nothing else),
`AGENTS.md` (conventions), `docs/10-verification-and-ai-hygiene.md` (how claims are made).
Create nothing else this turn. Do not write product code.

Deliverable — exactly these files, at these paths:

1. `package.json`
   - `"type": "module"`, `"private": true`, name `tablify`, version `0.1.0`.
   - Scripts, matching `docs/05`: `dev`, `build`, `typecheck`, `lint`, `lint:fix`, `format`,
     `format:check`, `test`, `test:watch`, `size`, `check` (and nothing else yet).
     `check` must be exactly: `bun run typecheck && bun run lint && bun run format:check && bun run test && bun run build && bun run size`.
   - devDependencies, pinned to these versions (verify each resolves before you write the file, and report
     the resolved versions): `obsidian@1.13.1`, `typescript@5.8.3`, `esbuild@0.25.5`, `eslint@9.39.4`,
     `typescript-eslint@8.59.1`, `eslint-plugin-obsidianmd@0.4.2`, `@eslint/js` (latest 9.x),
     `jiti` (latest), `globals` (latest), `prettier@3` (latest 3.x), `vitest@3` (latest 3.x),
     `jsdom` (latest), `@vitest/coverage-v8` (same minor as vitest), `@types/node` (latest 20.x).
   - dependencies: **none**. Not React yet — that comes with the grid, and it must be a decision I approve.
2. `tsconfig.json` — `target: ES2018`, `module: ESNext`, `moduleResolution: bundler`, `lib: ["DOM", "ES2018"]`,
   `strict: true`, `noImplicitAny`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`,
   `isolatedModules`, `verbatimModuleSyntax` if it compiles cleanly, `skipLibCheck: true`,
   `noEmit: true`, and an explicit `include` of `src`, `tests`, `scripts` that **excludes `prototype/`**.
3. `eslint.config.mts` — flat config via `defineConfig`, `globalIgnores(['prototype/**', 'main.js', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'dist/**'])`,
   `projectService: true` typed linting, and `obsidianmd.configs.recommended`. Add one
   `no-restricted-imports` rule that bans importing `obsidian` or `react` from anything under `src/core/`
   (the boundary rule the rest of the project depends on). No `eslint-disable` anywhere.
4. `.prettierrc` (`useTabs: true, tabWidth: 4, singleQuote: true, semi: true, printWidth: 100,
   trailingComma: "all"`) and `.prettierignore` (must ignore `prototype/**`, `main.js`, `coverage/**`,
   `pnpm-lock.yaml`, `bun.lock`).
5. `.editorconfig` matching the official sample plugin: `indent_style = tab`, `indent_size = 4`,
   `end_of_line = lf`, `charset = utf-8`, `trim_trailing_whitespace = true`, `insert_final_newline = true`.
6. `.gitignore` — `node_modules/`, `main.js`, `coverage/`, `playwright-report/`, `dist/`, `*.local`,
   `data.json`, `.DS_Store`. Note in a comment that `main.js` is a build artefact and is attached to
   releases only, never committed.
7. `esbuild.config.mjs` — per `docs/05`: bundle `src/plugin/main.ts`, `format: "cjs"`, `platform: "browser"`,
   `target: "es2018"`, `external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"]`, `sourcemap: "inline"`
   in dev, `minify` in production, `outfile: "main.js"`, and the standard `banner` with the licences.
   Support both `bun run dev` (watch) and `bun run build`.
8. `scripts/bundle-size.ts` — reads `main.js`, prints raw bytes and gzip bytes, and **fails (exit 1)** if
   raw > 900 KB or gzip > 300 KB. Also fails if `styles.css` exists and contains `!important`, and if
   `main.js` contains the string `prototype/`.
9. `vitest.config.ts` — two projects: `unit` (node environment, `tests/unit/**`) and `dom`
   (jsdom, `tests/dom/**`), coverage via v8 with glob-keyed thresholds:
   `'src/core/**': { lines: 85, functions: 85, statements: 85, branches: 75 }` and a global
   `lines: 60` floor that will rise as the project grows. `include`/`exclude` must exclude `prototype/**`.
10. `src/plugin/main.ts` — a **minimal but genuinely valid** plugin so the whole gate runs end to end:
    a default-exported `class TablifyPlugin extends Plugin` with `onload()` and `onunload()`, plus one
    registered command id `"show-version"` that shows a `Notice` with the plugin's manifest version.
    Registration only — no UI, no settings, no network.
11. `tests/unit/plugin-smoke.test.ts` — imports the plugin class with `obsidian` mocked (a small
    `vi.mock("obsidian", ...)` providing `Plugin`, `Notice`, `PluginSettingTab`), asserts the exported class
    extends `Plugin` and that the module has no top-level side effects. This is the test that proves the
    test runner can load plugin code at all.
12. `styles.css` — empty except for a one-line comment saying the real stylesheet arrives with the grid
    step. (Obsidian's release requires three assets; this keeps the release shape true from day one.)
13. `PROGRESS.md` at the repo root, in the format given in `prompts/README.md`, recording: M0 started,
    step 01 complete, the gate output, and the next step file name.

Constraints and fence:
- Touch only the files listed above. Do not create `src/core/**`, `src/grid/**` or `src/adapters/**` yet —
  not even empty folders.
- `prototype/**` is read-only reference material: never edited, never linted, never type-checked,
  never imported, never part of the bundle.
- No dependency beyond the devDependencies listed in item 1. If one of those exact versions no longer
  exists, stop and report the closest available version rather than choosing silently.
- No `any`, no `as`, no `@ts-ignore`, no `eslint-disable`, no non-null assertions.

STOP and report instead of proceeding if: `eslint-plugin-obsidianmd@0.4.2` or `typescript-eslint@8.59.1`
cannot be installed together with the pinned ESLint; or `obsidian@1.13.1` types fail to resolve; or the
`noUncheckedIndexedAccess` setting produces errors inside `node_modules/obsidian` (in that case report it
and leave the flag on).

Acceptance (run these and paste the raw output, not a summary):
- `bun install` — report the resolved version of every dependency in item 1.
- `bun run check` — must pass end to end on a tree with no product code.
- `bun run build && node scripts/bundle-size.ts` — report the raw and gzip size of the minimal `main.js`.
- `bun run lint` after deliberately adding `const x: any = 1;` to a scratch file — must fail; then delete
  the scratch file and re-run to show it passes. This proves the linter is not decorative.

REPORT BACK with: the file list you created; the raw `bun run check` output; the two bundle numbers;
the resolved dependency versions; the `minAppVersion` question left for step 02 (do not answer it yet);
anything you could not verify, marked ASSUMED with how I would verify it; and the exact next step.
