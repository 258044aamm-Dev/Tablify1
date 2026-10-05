Task: implement `BasesSource` (rows and values from a real Bases view, writes through the queue) and the
note-creation service. This is the step where the plugin first shows real data.

Read first: step 10's `spike/bases-path/FINDINGS.md` (your source of truth for the real API — if it
contradicts `docs/02`, the findings win and you report the doc correction), `docs/02-architecture.md`
§Bases integration, §Rows become notes, `docs/03` §frontmatter mapping, §snapshot/sync state
(you only need the local snapshot here), `docs/08-decisions.md` §P2, §P8, §E9,
`node_modules/obsidian/obsidian.d.ts` (quote `registerBasesView`, the view class, `BasesEntry`,
`BasesView.createFileForView`, `FileManager.processFrontMatter` with `@since` for each).

Deliverable:

1. `src/adapters/bases/BasesSource.ts` — implements the `RowSource` port:
   - `schema()`: builds the field list from the view's properties **and** the `.base` sidecar config
     (order, widths, hidden fields, row height, sorts, grouping, frozen primary) — the mapping table in
     `docs/03` §view config is the spec;
   - `rows()`: maps entries to rows keyed by `entry.file.path` (never by index — the docs are explicit that
     the data array is replaced wholesale on every update), reading each property through the registry's
     `parse` and keeping the raw YAML value alongside for round-trip safety;
   - `subscribe()`: fires on the view's data-update and on vault metadata changes that touch a file in the
     row set, coalesced to at most one notification per animation frame;
   - `apply(ops)`: translates ops into queue writes and optimistic overlay entries; returns a `WriteResult`
     with per-file status. Read-only columns (created/last-modified) produce a typed refusal, not a write;
   - `dispose()`: unsubscribes everything; no listeners on `window`/`document`, no timers left.
2. `src/plugin/TablifyView.ts` — replaces the placeholder from step 03: extends the Bases view class,
   constructs a `BasesSource` in `onload`/data callback, and renders a **minimal** DOM placeholder that
   shows the row and field counts plus the first three rows' `formatDisplay` values. The real grid arrives
   in step 17; this step's job is the data path, and the placeholder is deliberately ugly.
3. `src/adapters/notes/createNote.ts` — the note-creation service:
   - prefer the sanctioned path: `BasesView.createFileForView(baseFileName?, frontmatterProcessor?)`
     (`@since 1.10.2`), which handles filename collision and frontmatter in one call;
   - fall back to manual creation (`vault.create` in the configured folder with the configured filename
     template) **only** when a specific folder is required by settings, and document that decision in a
     doc comment;
   - the service takes `{ folder, filenameTemplate, frontmatter, fields }` and returns the created file
     path; it must apply the same `toYaml` rules as the queue (no duplicated serialisation logic — reuse
     the core function).
4. `tests/unit/bases-source.test.ts` — against a **fixture RowSource and the fake vault** (never a real
   vault): rows keyed by path survive an update that reorders and re-creates entries; a row whose file
   disappeared is dropped and does not resurrect; `apply` of a single cell op produces exactly one queued
   write and one overlay entry; a read-only column refuses the write with the typed reason; `subscribe`
   fires once per frame for ten rapid updates (use the fake clock).
5. `tests/unit/create-note.test.ts` — filename template collisions (`Project plan`, `Project plan (1)`),
   an empty template, a folder that does not exist (must fail with a clear error, not create in the root),
   and the manual fallback path.
6. A one-page `src/plugin/DEV-NOTES.md` — how to run the plugin against a scratch vault: the folder to
   place `main.js`+`manifest.json`+`styles.css`, the sample base file, and the three things to click.
7. `PROGRESS.md` updated, including the real-vault observation.

Constraints and fence:
- Touch `src/adapters/**`, `src/plugin/**`, `tests/**`, `PROGRESS.md`, and `styles.css` **only** if the
  placeholder needs a rule (keep it to a couple of lines).
- No React yet. No read of `data` outside the source class. No `vault.modify` anywhere.
- Writes go through the queue only: the source must not call `processFrontMatter` directly, and a test must
  assert that by injecting a queue spy.
- No `any`, no `as`, no `!`.

STOP and report instead of proceeding if: `createFileForView` is not callable from the view class at
runtime (then the service must use the fallback everywhere — say so and stop for my decision); or the
`.base` sidecar cannot store the view config keys `docs/03` lists; or `subscribe` cannot be made
frame-coalesced without a `window` listener (report the alternative you found).

Acceptance (paste raw output):
- `bun run check` — green.
- The fake-vault test results for the five assertions in item 4.
- A **real vault** observation: enable the plugin, open a base with a handful of notes, and paste the
  console/DOM evidence that the placeholder shows the correct row and field counts and three formatted
  values. Then change one property through the placeholder's write path (add a temporary command
  `"spike-set-cell"` for this, and delete it in the same commit — say so in the report) and paste the note's
  frontmatter before/after.
- If you cannot do the real-vault part, say so plainly and mark the whole data path ASSUMED — do not
  substitute the fixture.

REPORT BACK with: the file list; the raw gate output; the five fake-vault assertions; the real-vault
evidence or an honest ASSUMED; the doc corrections step 10 implied (one line each) for me to approve before
they are edited; the QueueSpy assertion; anything ASSUMED; the exact next step.
