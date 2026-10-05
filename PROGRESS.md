# PROGRESS

- Milestone: M0 — Foundation                                  Branch: main
- Last completed step: **step 02 — manifest and legal.** The repository is legally and technically
  release-ready: `manifest.json` (id `tablify`, `minAppVersion` 1.13.0, `isDesktopOnly: false`),
  `versions.json`, `CHANGELOG.md`, `LICENSE` (MIT, upstream copyright retained), `NOTICE`, an honest
  README skeleton, and two new gates — `brand:gate` and `manifest:check` — wired into `bun run check`
  right after `lint`.

- Verified (commands run, observed results):
  - `bun run check` → exit 0, now running: `tsc --noEmit`, `eslint .`, `brand:gate`, `manifest:check`,
    `prettier --check .`, `vitest run` (5 passed), `esbuild` production, `bundle-size` (802 B raw /
    532 B gzip, `!important` clean).
  - `bun run manifest:check` → 18 checks, all `ok`, exit 0. Deliberate failure: `version` set to `0.2.0`
    in `manifest.json` produced `FAIL newest versions.json key equals manifest version (0.1.0 vs 0.2.0)`
    and `FAIL CHANGELOG.md top version equals manifest version`, exit 1; reverted to `0.1.0`, green again.
  - `bun run brand:gate` → `OK — 60 permitted match(es), 0 violations`, and it prints every permission it
    grants. Deliberate failure: `src/scratch.ts` containing `// a Claude test` produced
    `src/scratch.ts:1` as a violation and exit 1; the scratch file was deleted and the gate returned to
    `OK`. The gate also caught a real problem while being written: the third physical line of the NOTICE
    attribution paragraph fell outside the three-line window, so NOTICE was rewritten one clause per line.
  - `git status --short` during the step listed only: `README.md`, `manifest.json`, `package.json`
    (modified) and `CHANGELOG.md`, `LICENSE`, `NOTICE`, `scripts/brand-gate.ts`,
    `scripts/manifest-check.ts`, `versions.json` (new) — plus `PROGRESS.md`, which this step owns.
  - Upstream `LICENSE` read at `../airtable-tabula/LICENSE`: MIT, `Copyright (c) 2026 MehulG`,
    reproduced verbatim in `LICENSE` above `Copyright (c) 2026 258044aamm-Dev`. Permissive — no STOP.

- `minAppVersion` decision and its evidence (quoted from `node_modules/obsidian/obsidian.d.ts`):
  - `registerBasesView` — the function that makes this plugin a Bases view:
    `* @since 1.10.0` → `registerBasesView(viewId: string, registration: BasesViewRegistration): boolean;`
  - `export abstract class BasesView extends Component` — `* @since 1.10.0`
  - `createFileForView(...)` — `* @since 1.10.2`
  - Reading: the API floor we depend on is **1.10.2**, i.e. *lower* than the 1.13.0 the prompt specifies,
    so there is no reason to raise the floor and no STOP condition. 1.13.0 is kept as a deliberate
    choice: it is the version this project actually tests against, and `docs/06` defines `minAppVersion`
    as "the lowest version you actually test on". Lowering it to 1.10.2 is a one-line change in
    `manifest.json` + `versions.json` once the step-10 spike has run on a 1.12.x install.
  - **Docs correction worth recording:** the planning material states 1.13.0 as *the API floor* for
    `registerBasesView`. The declaration says 1.10.0. `docs/10`'s claim ledger should say "1.10.0 in the
    API; 1.13.0 chosen as the tested floor".

- Assumed / not verified (each with how to verify):
  1. `1.13.0` is a floor the author will actually test on. Verify in the step-10 spike (install the
     built plugin on 1.13.x, then try 1.12.x if lowering is wanted).
  2. The `src/sync/` brand permissions (two named patterns) have not matched anything yet: the sync
     module does not exist. Verify at step 25 — the gate will name any line it cannot permit.
  3. `README.md` deliberately does **not** name the sync service, per `docs/09` ("no third-party company
     names in the plugin name, `description`, README headings, settings copy, screenshots or repo
     metadata"). If the service should be named in the README, that needs one more named permission.
  4. The brand gate treats `main.js` (generated, git-ignored) as out of scope and skips `docs/**` and
     `prototype/**` exactly as the step specifies. Verify by reading `SKIP_DIRS` in `scripts/brand-gate.ts`.

- Half-finished: nothing.

- Open questions for the human:
  1. `docs/09-publishing.md` line 33 shows a template `description` that contains the word "Airtable",
     while line 79 of the same document forbids third-party company names in `description`. The
     contradiction is real and the template is the stale half; `manifest.json` follows line 79. Default:
     leave `docs/**` untouched (this step's fence) and correct `docs/09` in a later docs pass.
  2. Three description options were written. In the file:
     "Spreadsheet-class grid view for Bases: range selection, block paste, fill down, bulk edits, undo,
     and CSV/XLSX round-trips on top of your notes." (144 chars). Alternatives considered: (b) "A
     spreadsheet-grade grid for Bases: select ranges, cut and paste blocks, fill down, bulk-edit cells,
     and import or export CSV and XLSX without leaving your vault." (158) and (c) "Bases, but with
     spreadsheet hands: range selection, block clipboard, fill down, multi-step undo, and CSV/XLSX import
     and export over your notes." (139). Say which you prefer and it is a one-line change.
  3. `PROGRESS.md`, `docs/**`-adjacent internal notes and `prompts/**` are permitted as whole files by
     `brand-gate`. If you would rather the gate scan them line by line, that is a configuration change,
     not a code change.

- Next step: `prompts/step-03-plugin-shell-and-build.md`.

- Files touched this step: `manifest.json`, `package.json`, `README.md`, `PROGRESS.md`, `CHANGELOG.md`,
  `LICENSE`, `NOTICE`, `versions.json`, `scripts/brand-gate.ts`, `scripts/manifest-check.ts`.

- Earlier: step 01 — toolchain and gate, `bun run check` exit 0, bundle 802 B raw / 532 B gzip; forced
  amendments (manifest.json, the `obsidian` test double, CommonJS scoping for `tools/` and `prototype/`)
  are recorded in `prompts/README.md` under "Amendments applied during execution".
