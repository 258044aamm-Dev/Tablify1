# PROGRESS

- Milestone: M0 — Foundation                                  Branch: main
- Last completed step: **step 03 — plugin shell and build.** The plugin is a real plugin shell: a Bases
  view type, two commands, a settings tab, a status bar item, the keyboard table as data, and two
  release scripts (`release-assets`, `version-bump`). Still no product logic and no data access.

- Verified (commands run, observed results):
  - `bun run check` → **exit 0**: `tsc --noEmit` silent; `eslint .` 0 errors / 1 warning (see below);
    `brand:gate` OK (60 permitted, 0 violations); `manifest:check` OK; `prettier --check .` clean;
    `vitest run` **16 passed (3 files)**; esbuild production; `bundle-size` OK.
  - Bundle: `main.js raw 3905 bytes (3.81 KB)`, `gzip 1843 bytes (1.80 KB)`.
    Step 01 was 802 B raw / 532 B gzip. The delta is the plugin shell itself: the registration payload
    with its factory, two commands, the `KeyboardHelpModal`, the setting tab, the 15-row keyboard table
    and the status bar item — all of it real code that now ships.
  - `bun scripts/release-assets.ts --tag 0.1.0 --allow-dirty` → three assets (`main.js` 3905,
    `manifest.json` 359, `styles.css` 101) copied to `dist/0.1.0/`, then
    `dist/0.1.0/ contains exactly 3 files: main.js, manifest.json, styles.css`. Refusals, all exit 1 with
    one clear line each: `--tag v0.1.0` ("must not have a v prefix"), `--tag 0.2.0` ("does not equal
    manifest version 0.1.0"), no tag at all, and a dirty tree without `--allow-dirty`.
  - `bun scripts/version-bump.ts patch` → `0.1.0 → 0.1.1`, all four files updated, `manifest:check` green
    at the new version, and `version-bump.ts huge` refused with exit 1. The bump was then reverted
    (`git checkout -- manifest.json package.json versions.json CHANGELOG.md`) because it was only a proof.
  - Tests, by file: `tests/unit/plugin-smoke.test.ts` (7) — two commands, the version Notice, the help
    modal opening, the unload contract; `tests/unit/bases-registration.test.ts` (5) — one registration,
    the documented id/name/icon, the factory building into the container it is handed, an inert
    `onDataUpdated`, and nothing left registered after unload; `tests/dom/settings-tab.test.ts` (4) — one
    tab, a heading plus intro paragraph, no inputs, and no duplicate on re-display.

- **Real-vault observation: ASSUMED — not performed.** This environment has no Obsidian installation, so
  I cannot enable the plugin in a vault, press the command or open the settings tab. Do not read the
  tests as a substitute; they prove the wiring against a double, not against the app. To verify on your
  machine: `bun run build`, then symlink or copy the repo into
  `<vault>/.obsidian/plugins/tablify/` (it needs `main.js`, `manifest.json`, `styles.css`), enable it in
  Settings → Community plugins, and confirm in order: (1) the notice-free load, (2) command
  “Show version” → Notice `Tablify 0.1.0`, (3) command “Open keyboard help” → the modal lists 15 bindings,
  (4) the status bar shows an empty Tablify item, (5) Settings → Tablify shows the heading and the
  pre-release paragraph, (6) a new Bases view offers “Tablify grid” with the `lucide-table-2` icon and
  renders the placeholder text in a note.

- Assumed / not verified (each with how to verify):
  1. The real-vault checklist above.
  2. Obsidian calls `BasesViewFactory(controller, containerEl)` exactly as typed (`QueryController` first,
     `HTMLElement` second). The type is quoted in the source; the runtime order can only be confirmed in
     the app, in the same session as item 1.
  3. `registerBasesView` returning `false` when Bases is disabled: the notice branch is written but has
     never been observed. Verify by disabling the Bases core plugin in a vault and reloading.
  4. `bun scripts/release-assets.ts`: the prompt says `node scripts/release-assets.ts`, but Node cannot
     execute TypeScript, so the script is run with `bun` (the convention step 01 set for `scripts/*.ts`).
     Worth correcting in the prompt text.

- Findings worth keeping:
  1. **`BasesView` has `protected constructor(controller: QueryController)` (@since 1.10.0)** — the step-01
     note "no constructor of its own" was wrong, and the compiler caught it (`Expected 1 arguments, but
     got 0`). The placeholder view now calls `super(controller)`.
  2. **There is no `unregisterBasesView` in obsidian.d.ts @ 1.13.1.** A Bases view type is detached by
     Obsidian when the plugin unloads, so `onunload()` calls `super.onunload()` and releases nothing by
     hand — and the double mirrors that framework behaviour so the test's assertion is not vacuous.
  3. **`obsidianmd/ui/sentence-case` lowercases product names**: it wanted "tablify" and "bases" in a
     user-facing Notice. That is a false positive on proper nouns, so `eslint.config.mts` now configures
     `brands: ['Tablify', 'Bases']` and `acronyms: ['CSV', 'TSV', 'XLSX', 'URL']` for `src/**`.
  4. **One warning is deliberately left standing**: `obsidianmd/settings-tab/prefer-setting-definitions`
     asks the tab to adopt the 1.13 declarative settings API. Adopting it changes how the tab renders, so
     it belongs with the settings schema in step 14 — not now, and not as a way to silence a warning.
  5. The linter also required `new Setting(containerEl).setName(..).setHeading()` instead of a raw `<h2>`
     (an error, now fixed) and `createDiv` instead of `createEl('div', ..)` (a warning, now fixed).

- Half-finished: nothing. `TABLIFY_PLACEHOLDER_TEXT` is the only user-visible string the view renders.

- Open questions for the human:
  1. Real-vault verification of the six-step checklist above — the only thing this step could not do.
  2. Should `dist/0.1.0/` be produced locally at all, or only in CI? It is git-ignored either way; the
     script exists so the release shape is asserted before a tag is pushed.

- Next step: `prompts/step-04-ci-and-release.md`.

- Files touched this step: `src/plugin/main.ts`, `src/plugin/TablifyPlaceholderView.ts`,
  `src/plugin/settings/TablifySettingTab.ts`, `src/plugin/help/keyBindings.ts`,
  `scripts/release-assets.ts`, `scripts/version-bump.ts`, `tests/mocks/obsidian.ts`,
  `tests/unit/plugin-smoke.test.ts`, `tests/unit/bases-registration.test.ts`,
  `tests/dom/settings-tab.test.ts`, `eslint.config.mts`, `PROGRESS.md`.

- Earlier steps: 01 toolchain and gate (`bun run check` exit 0, 802 B / 532 B bundle);
  02 manifest and legal (manifest/versions/changelog/licence/notice plus the `brand:gate` and
  `manifest:check` gates — `minAppVersion` 1.13.0 is the tested floor, while the Bases API itself is
  @since 1.10.0 with `createFileForView` @since 1.10.2). Forced amendments are recorded in
  `prompts/README.md` under "Amendments applied during execution".
