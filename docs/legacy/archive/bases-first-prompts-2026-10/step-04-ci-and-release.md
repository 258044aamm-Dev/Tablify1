Task: make CI the referee. Two workflows: `ci.yml` (the gate on every push and pull request) and
`release.yml` (a tag produces exactly three assets on a GitHub release). Then run the workflow's steps
locally, in order, so I know CI will not surprise us later.

Read first: `docs/05-toolchain-and-ci.md` §CI and §release (the exact step list, caching, and the
`frozen-lockfile` rule), `docs/09-publishing.md` §release mechanics, `AGENTS.md`.

Deliverable:

1. `.github/workflows/ci.yml`
   - Trigger: `push` to any branch, `pull_request`, and `workflow_dispatch`.
   - One job `gate` on `ubuntu-latest`: checkout, `oven-sh/setup-bun@v2` with `bun-version: 1.4.2`,
     `bun install --frozen-lockfile`, then the gate steps in this exact order: `typecheck`, `lint`,
     `format:check`, `test`, `build`, `size` (`size` must fail the job when over budget), then
     `bunx playwright install --with-deps chromium` and `test:layout`. Upload `playwright-report` with
     `if: always()`.
   - Cache `~/.bun/install/cache` keyed on `bun.lock`, and the Playwright browser cache keyed on the
     Playwright version. Add `concurrency` to cancel superseded runs.
2. `.github/workflows/release.yml`
   - Trigger: `push` of a tag matching a version pattern **without** a `v` prefix.
   - Steps: the full `bun run check` gate first (a release must never be cut from a tree that does not
     build), then `node scripts/release-assets.ts --tag "$GITHUB_REF_NAME"`, then create/update the GitHub
     release for that tag and upload **exactly three** assets: `main.js`, `manifest.json`, `styles.css`.
   - The job must fail with a clear message if the tag does not match `manifest.json`'s version, or if
     `dist/<version>/` does not contain exactly three files.
   - Permissions: `contents: write` only. No secrets, no tokens in the workflow beyond `GITHUB_TOKEN`.
3. `.github/dependabot.yml` — weekly, `bun` ecosystem for `/`, grouped into a single PR, and it must not
   auto-merge or bump `obsidian` (Bases API floor) without a human: configure the `obsidian` ignore so a
   major bump is proposed but never auto-applied by a patch PR.
4. `docs/05-toolchain-and-ci.md` stays untouched. If CI needs a command the doc does not list, add it to
   `package.json` and note the addition in `PROGRESS.md`, not in the doc.
5. `PROGRESS.md` updated: step 04 complete; the note that `test:layout` will fail until step 21 —
   the workflow must therefore be written so that the missing spec **fails loudly** rather than being
   skipped. State how you achieved that (e.g. the layout job runs only when `harness/**` exists, with an
   explicit comment; and the `gate` job's layout step is guarded the same way). Choose one approach,
   implement it, and tell me which.

Constraints and fence:
- Touch only `.github/**`, `package.json` (only if a script is missing) and `PROGRESS.md`.
- No `continue-on-error`, no `|| true`, no `if: success()` that turns a failing step non-fatal, and no
  step that silently skips the gate on a tag build.
- No action pinned to a floating major tag other than the ones named above (`actions/checkout@v4`,
  `actions/upload-artifact@v4`, `oven-sh/setup-bun@v2`, and the release step you choose). If you use a
  third-party release action, justify it and pin it to a commit SHA.

STOP and report instead of proceeding if: a step in the workflow cannot run headlessly on `ubuntu-latest`;
or the release asset upload cannot be expressed without a third-party action you cannot pin.

Acceptance (paste raw output, in this order):
- Run the `gate` job's steps locally, one command per line, in the workflow's order, and paste each
  command's output tail. The sequence must end green.
- `act` or `actionlint` if you have either available: paste the result. If you do not, say so and instead
  paste the workflow files' YAML parse check (`node -e "require('js-yaml')..."` is acceptable if you add
  `js-yaml` as a dev-only devDependency — ask me first).
- Simulate the release path locally: `TAG=0.1.0 node scripts/release-assets.ts --allow-dirty`, then show
  the three files in `dist/0.1.0/`.
- Show the CI would fail on a red gate: introduce a deliberate type error, run `bun run typecheck`, show
  the failure, revert.

REPORT BACK with: the file list; the raw local run of the whole gate sequence; the result of the YAML
validation; the release simulation output; the approach you chose for the not-yet-existing layout spec and
why; anything ASSUMED (including "I could not run actionlint"); the exact next step.
