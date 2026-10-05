# PROGRESS

- Milestone: M0 — Foundation (complete)                        Branch: main
- Last completed step: **step 04 — CI and release.** CI is now the referee: `.github/workflows/ci.yml`
  (the gate on every push, pull request and manual dispatch), `.github/workflows/release.yml` (a bare
  `x.y.z` tag produces a GitHub release with exactly three assets) and `.github/dependabot.yml`.

- Verified (commands run, observed results):
  - **The `gate` job's steps, run locally in the workflow's exact order**, each ending green:
    `bun install --frozen-lockfile` → "Checked 478 installs across 511 packages (no changes)";
    `bun run typecheck` → silent; `bun run lint` → 0 errors, 1 warning (the deferred declarative-settings
    advisory below); `bun run format:check` → "All matched files use Prettier code style!";
    `bun run test` → 16 passed (3 files); `bun run build` → silent; `bun run size` →
    `main.js raw 3905 B / gzip 1843 B`, `!important` clean, `bundle-size: OK`. Sequence exit 0.
  - **YAML validation**: `actionlint` and `act` are not available in this environment, so all three files
    were parsed with PyYAML (already installed — no new dependency, so the js-yaml question did not
    arise): `ci.yml`, `release.yml` and `dependabot.yml` all parse. (PyYAML prints the `on:` key as
    `True`, which is YAML 1.1 treating `on` as a boolean; GitHub Actions reads it as the key `on`.)
  - **The written guard behaves as documented**: running the `harness` step with `GITHUB_OUTPUT` and
    `GITHUB_STEP_SUMMARY` set produced `present=false` plus the annotation
    `::warning title=Layout gate not running::…` and a job summary reading "### Layout gate not running".
  - **A red gate fails CI**: a deliberate type error (`src/type-error.ts`, a string assigned to a number)
    made `bun run typecheck` exit 2 with `error TS2322`; the file was deleted and typecheck returned to
    green. Nothing in the workflow turns a failure into a pass: there is no `continue-on-error`, no
    `|| true`, and no `if: success()`.
  - **Release simulation**: `TAG=0.1.0 bun scripts/release-assets.ts --allow-dirty` produced
    `dist/0.1.0/` holding exactly `main.js` (3905 B), `manifest.json` (359 B), `styles.css` (101 B).
  - Running the sequence locally **found two real problems before CI did**: `format:check` failed on the
    three new YAML files (now formatted by Prettier), and `prefer-create-el` fired on the test double's
    `createDiv` implementation (now refactored so the stub builds children through a helper).

- **The approach chosen for the not-yet-existing layout spec, and why.** The Playwright harness arrives in
  step 21, so `bun run test:layout` cannot pass today. Three options existed: (a) run it unconditionally
  and live with a red CI until step 21; (b) `continue-on-error` / `|| true`; (c) a visible, self-retiring
  guard. (a) trains everyone to ignore a red badge, and a permanently red CI is how a suite gets deleted
  later; (b) is exactly the silent skip the step forbids. So the workflow implements (c):
  a `Check whether the layout harness exists yet` step sets `present=true|false`, and the Playwright
  install, the layout run and the report upload are guarded on it. When the harness is absent the run
  carries a GitHub **warning annotation** and a **job summary** saying the layout gate is not running and
  why — impossible to overlook, and it retires itself the moment `playwright.config.ts` and `harness/`
  exist, with no workflow edit needed to start passing.
  `package.json` gained `test:layout` (`playwright test`) so the reference is valid now and fails loudly
  rather than doing nothing.
  **Close-out for step 21:** delete the `harness` step and the three `if:` conditions in `ci.yml` so the
  layout suite runs unconditionally. That instruction is also written as a comment in the workflow itself,
  next to the guard.

- Assumed / not verified (each with how to verify):
  1. **The workflows have never executed on GitHub.** Everything above is a local simulation of the step
     list plus a YAML parse. Verify by pushing a commit and reading the run in the Actions tab (or
     `gh run watch`). The first push after this step should show the `gate` job green and the layout
     annotation present.
  2. `oven-sh/setup-bun@v2` with `bun-version: 1.4.2` — the version string format is taken from the
     action's documented input; unverified in a real run.
  3. Dependabot's `bun` ecosystem support: configured as the step specifies, but no Dependabot run has
     been observed. Verify by watching for the first weekly PR, or by choosing "Check for updates" in the
     Insights → Dependency graph tab.
  4. No provenance attestation. `docs/05` lists it as optional and it would need a third-party action
     pinned to a commit SHA, which cannot be fetched and verified from this environment; skipping is
     deliberate, not an oversight.

- Findings worth keeping:
  1. `node scripts/release-assets.ts` (as written in the step and in `docs/05`) cannot work: Node does not
     execute TypeScript. Both the local run and `release.yml` use `bun scripts/release-assets.ts`, which is
     the convention step 01 established for `scripts/*.ts`. `docs/05` is not touched, per the fence.
  2. Release notes are extracted from `CHANGELOG.md` by tag, and an empty or missing section is a hard
     failure — the previous project published "Test Release" placeholders, which is what this prevents.
  3. The release job uses the preinstalled `gh` CLI with `GITHUB_TOKEN`, so no third-party release action
     is needed and nothing has to be pinned to a SHA.
  4. The one standing lint warning (`obsidianmd/settings-tab/prefer-setting-definitions`) is unchanged and
     still belongs to step 14, which owns the settings schema.

- Half-finished: nothing. `dist/` is git-ignored; `main.js` remains a build artefact only.

- Open questions for the human:
  1. Should the layout guard emit a warning (current choice) or fail the run until step 21? A failing run
     would be a stronger signal but leaves CI red for the rest of M0–M2.
  2. Dependabot: the `obsidian` ignore covers `version-update:semver-major` only, so minor and patch
     bumps are still proposed. If every `obsidian` bump should be human-gated, say so and the ignore list
     changes.

- Next step: `prompts/step-05-fakes-boundaries-coverage.md` (M1 — core domain, no Obsidian and no React:
  `src/core/**` plus the fakes, the boundary lint rule in action, and coverage enforced).

- Files touched this step: `.github/workflows/ci.yml`, `.github/workflows/release.yml`,
  `.github/dependabot.yml`, `package.json` (adds `test:layout`), `tests/mocks/obsidian.ts`,
  `PROGRESS.md`.

- Earlier steps: 01 toolchain and gate (802 B / 532 B bundle, `bun run check` exit 0); 02 manifest and
  legal (`brand:gate`, `manifest:check`, `minAppVersion` 1.13.0 as the tested floor); 03 plugin shell
  (Bases view registration, two commands, settings tab, status bar item, `release-assets` and
  `version-bump`; 16 tests). Forced amendments are recorded in `prompts/README.md` under "Amendments
  applied during execution".
