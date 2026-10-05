Task: SPIKE — prove on a real Obsidian vault, before any adapter is written, that the Bases data path
behaves the way `docs/02-architecture.md` claims. This is a stop-and-report step: write at most 50 lines,
gather evidence, and stop. Do not build the adapter in this turn.

Read first: `docs/02-architecture.md` §Bases integration and §RowSource (this is the claim being tested),
`docs/10-verification-and-ai-hygiene.md` §the spike rule and §cite-or-die,
`node_modules/obsidian/obsidian.d.ts` — quote the exact declarations you rely on:
`registerBasesView`, its options type, the view class you extend, `BasesEntry`, `config`, `data`,
`getValue`, `BasesView.createFileForView`, and `App.fileManager.processFrontMatter`, each with its `@since`.

Deliverable:

1. `spike/bases-path/main.ts` — a throwaway plugin (its own folder, its own `manifest.json`
   with id `tablify-spike`, `isDesktopOnly: false`) that registers one Bases view type and, in its data
   callback, logs exactly this, each on its own labelled line:
   - the view's container size at mount (`getBoundingClientRect()` of `containerEl`, and its parent),
   - `config.getOrder()` and `config.getSort()` as JSON,
   - the number of entries and the first entry's `file.path`,
   - for one named property: the raw entry value, the `getValue()` result and its constructor name,
   - whether `BasesEntry` exposes any write path (search the declaration and say yes/no with the symbol),
   - whether the view class exposes `createFileForView` at runtime, and what it returns when called.
2. A note in `spike/bases-path/README.md` with the exact steps I must repeat by hand (which folder to put
   the plugin in, how to enable it, which base file to open, what to look for).
3. `spike/bases-path/write-test.ts` — a second, equally small command that, when run from the command
   palette, changes one property on the file that is currently first in the view using
   `app.fileManager.processFrontMatter`, then logs the file's text before and after (read with
   `vault.read` before and after the write, as strings, so the diff is real).
4. A written report in `spike/bases-path/FINDINGS.md`, containing:
   - the raw console output (pasted, not paraphrased),
   - the real note diff (before/after text, with unknown frontmatter keys and comments visible),
   - the exact Obsidian version and platform you ran it on,
   - a row-per-claim table: claim from `docs/02` | observed | VERIFIED or DIFFERENT | the evidence line,
   - anything you could not test on your machine, marked ASSUMED with the reason,
   - one paragraph: if `docs/02` disagrees with the real API, what the docs should say instead.

Constraints and fence:
- Touch only `spike/**` and `PROGRESS.md`. The spike is not part of the build: add `spike/**` to
  `eslint.config.mts`'s ignores and to `tsconfig.json`'s `exclude` (or, cleaner, give the spike its own
  `spike/bases-path/tsconfig.json` and its own build command) — choose one, state which, and make sure
  `bun run check` ignores the spike entirely. Do not let it into `main.js`.
- Never modify a note in a vault the user cares about without printing the path first: the write test must
  log "about to change <path>" and only proceed if the property it changes is the one named in the report.
- No `any` in the spike either. Casting `unknown` is allowed **only** with a one-line comment naming the
  declaration you are trusting.

STOP and report instead of proceeding if: `registerBasesView` is not present at 1.13.1; or the view class
required by the factory cannot be constructed in a spike without undocumented members; or
`config.getOrder()`/`getSort()` do not exist on the options object. In each case: paste the declaration you
did find, and stop. A failed spike is a successful outcome — report it plainly rather than coding around it.

Acceptance (paste, not summarise):
- `bun run check` — green and provably ignoring `spike/**`.
- The raw console output from the running plugin, with the labels above.
- The real note diff from the write test.
- The FINDINGS.md claim table.
- The exact Obsidian version you tested on, and whether you also tried it on a phone (if not, say so).

REPORT BACK with: the spike file list; the raw evidence; the claim table; the doc correction you propose
(if any) with the exact sentence to change; anything ASSUMED; and the exact next step — which is the
RowSource port, and it must be gated on my confirmation of this report.
