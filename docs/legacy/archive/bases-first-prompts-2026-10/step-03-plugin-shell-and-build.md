Task: turn the minimal plugin from step 01 into a real plugin shell — lifecycle, one command, one status
bar item, a settings tab that exists but holds nothing yet, and a registered Bases view type whose factory
renders a placeholder. Plus the release-asset script. Still no product logic.

Read first: `docs/02-architecture.md` §Bases integration and §plugin layout, `docs/09-publishing.md`
§release mechanics (three assets, tag == version), `docs/01-spec.md` §entry points,
`node_modules/obsidian/obsidian.d.ts` — and quote from it, with `@since`, every API you use in this step:
`Plugin.registerBasesView`, `BasesViewFactory`, `Plugin.registerView` (only if you also use it),
`Plugin.addSettingTab`, `PluginSettingTab`, `Notice`, `Plugin.addStatusBarItem`, `Plugin.registerEvent`.

Deliverable:

1. `src/plugin/main.ts` — grown from step 01:
   - `onload()`: register one Bases view type with id `"tablify-grid"`, name `"Tablify grid"`, the Lucide
     icon name the docs pick, and a factory that returns a `TablifyView` (a placeholder subclass defined in
     `src/plugin/TablifyPlaceholderView.ts` for now, rendering a single element with the text
     "Tablify grid — not wired to data yet" and a note in a comment saying step 17 replaces it).
   - Register exactly two commands: `"show-version"` (Notice with the manifest version, kept from step 01)
     and `"open-keyboard-help"` (opens a `Modal` with a static list of the key bindings from
     `docs/01-spec.md` — the text comes from a single exported constant so the real help modal can reuse it).
   - One status bar item whose text is empty until a view mounts (proves the API path without pretending
     to have data).
   - `onunload()`: detach what you registered; no timers, no global listeners left behind.
   - Every Obsidian API call must carry a one-line comment citing `obsidian.d.ts` file + symbol + `@since`,
     so a reviewer can verify it without searching.
2. `src/plugin/settings/TablifySettingTab.ts` — a `PluginSettingTab` with a title, an intro paragraph that
   states the plugin is pre-release, and **no settings rows yet**. The tab must render without a settings
   object (the settings schema arrives in step 14).
3. `src/plugin/help/keyBindings.ts` — the key-binding table as data (id, keys, description), transcribed
   from `docs/01-spec.md` §keyboard. No UI logic.
4. `scripts/release-assets.ts` — builds the three release assets exactly as Obsidian expects and validates
   them: (a) `main.js` from the production build, (b) `manifest.json`, (c) `styles.css`. It must:
   - refuse to run if the working tree is dirty, unless `--allow-dirty` is passed,
   - read the version from `manifest.json` and refuse if `process.env.TAG` (or `--tag=`) does not equal it
     exactly, and refuse a `v` prefix outright,
   - copy the three files into `dist/<version>/` and print their names and sizes,
   - verify `dist/<version>/` contains **exactly** three files.
5. `scripts/version-bump.ts` — takes `patch|minor|major`, updates the version in `manifest.json`,
   `package.json`, `CHANGELOG.md` (adding a dated heading) and `versions.json` (adding the new version →
   current `minAppVersion`), and prints a one-line summary. It must not commit or tag anything.
6. `tests/dom/settings-tab.test.ts` — jsdom test with `obsidian` mocked: the setting tab's `display()`
   renders the title and the intro paragraph, contains zero `input` elements (nothing to configure yet),
   and does not throw.
7. `tests/unit/bases-registration.test.ts` — jsdom test with `obsidian` mocked: loading the plugin requires
   exactly one `registerBasesView` call, with the id `tablify-grid`, a non-empty name, and a factory that
   returns an object whose `containerEl` the plugin sets; calling `onunload()` leaves no registered view.
8. Update `PROGRESS.md`.

Constraints and fence:
- No data access, no `BasesEntry`, no `processFrontMatter`, no React in this step. The placeholder view may
  not read `this.data`.
- No new dependency. No `any`, no `as`, no `!`, no `eslint-disable`.
- Do not modify `esbuild.config.mjs` (step 01 owns it) except if `bun run build` genuinely cannot build the
  new files — in that case stop and report rather than loosening the config.
- Do not touch `protected`/`private` boundaries of the Obsidian classes with casts to fake them in tests;
  build the fakes in the mock instead.

STOP and report instead of proceeding if: `registerBasesView` is not present in `obsidian.d.ts` at 1.13.1
with the signature you planned to use; or the `BasesViewFactory` type cannot be satisfied without `any`;
or `Plugin.addStatusBarItem` does not exist.

Acceptance (paste raw output):
- `bun run check` — green, including the two new test files.
- `bun run build && node scripts/bundle-size.ts` — report the new raw/gzip sizes and compare them with
  step 01's numbers.
- `bun run build && node scripts/release-assets.ts --tag 0.1.0 --allow-dirty` — show the three asset names
  and sizes; then show it **refuses** with a tag of `v0.1.0` and with `0.2.0`.
- A screenshot or console paste of the plugin loaded in a real vault: enable it, confirm the command shows
  the version Notice, the status bar item appears empty, the settings tab opens, and the help modal lists
  the bindings. If you cannot load it in a real vault, say so plainly and mark it ASSUMED — do not
  substitute a harness for the real app in this step.

REPORT BACK with: the file list; the raw gate output; the bundle size delta with a sentence on what caused
it; the release-asset output including both refusals; the real-vault observation or an honest ASSUMED;
anything you could not verify; the exact next step.
