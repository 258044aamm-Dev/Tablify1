# R2 — Database repository and Obsidian file view

**Mode:** implementation guide. Authorized for implementation 2026-10-07 (see [`08-decisions.md`](08-decisions.md) §Implementation authorization log): steps commit and push one at a time on `refactor/native-tablify`. **Status:** complete — steps 1–7 are implemented, gated and pushed ✅ (each step a commit on `refactor/native-tablify`); implementation state is always the source at HEAD. **Real-device behaviour stays NOT RUN** until the user runs [`probes/r2-file-view/`](../probes/r2-file-view/README.md) on desktop and phone and the log is pasted into [`manual-test-log.md`](manual-test-log.md) §"R2 — FileView probe kit" (ADR-0010: the floor stays 1.13.0). **Dependencies:** R1 schema frozen (✅ complete); Obsidian API assumptions are checked against the pinned typings ([`10-verification-and-ai-hygiene.md`](10-verification-and-ai-hygiene.md) §Required claims ledger) and, for the app-version question, by the user-run probe kit in [`probes/r2-file-view/`](../probes/r2-file-view/README.md) — never claimed from typings alone (ADR-0010). **Blocking decisions:** ADR-0005 (external edit, never a silent overwrite), ADR-0010 (app-version floor stays at 1.13.0 until the probes report).

## Objective

Make a `.tablify` document open as an Obsidian-native file view, and provide a safe in-memory repository for its data. This replaces `TablifyView extends BasesView`, the Bases registration path, note-backed sources, and `.base`-owned view config.

## Why this is a separate phase

The document is one multi-table write unit. The current `RowSource` assumes a single table and note-path row IDs, while current writes are queued by Markdown file and use frontmatter. A `.tablify` edit must serialize the database document without losing a concurrent pane’s or Obsidian Sync’s newer revision. Do not claim R2 is complete by only registering a file extension.

## Step-by-step plan

### Step 1 — Verify the host API surface ✅ landed

Read `node_modules/obsidian/obsidian.d.ts` from the repo’s pinned `obsidian@1.13.1` and the official Obsidian custom-view docs. The documented direction is `registerView` plus `registerExtensions`; exact callbacks/lifecycle must be verified for the oldest supported app version.

Before product changes, create a tiny throwaway API proof (future implementation task, not this documentation task) that:

- registers a view type and maps the `tablify` extension to it;
- opens a generated `.tablify` file in a scratch vault;
- receives the file-load and unload/lifecycle events;
- handles rename and close safely;
- writes a text change through an Obsidian-notifying vault API and observes the modify event;
- works on the actual minimum desktop and mobile Obsidian versions selected for release.

Do not copy the old Bases spike or assume `registerExtensions` alone is the whole file-view lifecycle. Record symbol, signature, `@since`, test app versions, output, and any differences in the claim ledger.

### Step 2 — Separate database lifetime from grid lifetime ✅ landed

Use one repository/session per logical open database document. Suggested boundary:

```ts
interface DatabaseRepository {
  readonly databaseId: DatabaseId;
  getSnapshot(): DatabaseDocument;
  subscribe(listener: () => void): () => void;
  dispatch(command: DatabaseCommand): ApplyResult;
  flush(): Promise<WriteResult>;
  dispose(): Promise<void>;
}
```

The exact interface is a design proposal, not a mandated signature. It must:

- own one validated in-memory snapshot and revision;
- expose active-table projections without re-parsing JSON per cell;
- route every mutation through pure operations and inverses;
- serialize writes for the whole document, not per cell or per row;
- report parse, validation, conflict, and disk-write outcomes distinctly;
- release event subscriptions, timers, queued work, and React roots on close.

Keep `src/core` independent of Obsidian. Put Obsidian `TFile`, `Vault`, `Workspace`, event and view lifecycle in the adapter/plugin boundary.

### Step 3 — Specify the file I/O port ✅ landed

Introduce an injectable text-file port (name to be chosen in implementation) with operations for read, create, write/replace, event subscription, rename/delete handling, and optional recovery/backup. The unit tests use an in-memory fake. The real adapter uses a documented Obsidian-supported API that notifies the vault; verify exact guarantees instead of reaching around it with an untracked raw write.

File rules:

- New database creation writes a valid minimum `.tablify` document before asking Obsidian to open it.
- File path is an address, not the database ID. Rename updates the session path without changing database/table/row identity.
- Preserve the last known-good text/snapshot on parse/write failure; do not overwrite a damaged file with defaults.
- The host can offer a copy/export of corrupt text for recovery, but the core parser never writes it.

### Step 4 — Define a document-level write queue ✅ landed

The future queue should serialize whole-document revisions and coalesce work from one user action. Document the state machine before coding:

```text
command → validate operation → optimistic snapshot → mark dirty revision
        → serialized flush → compare disk revision with loaded revision
        → write document → acknowledge revision / surface error
```

Decide and test:

- when cell edits flush (debounce maximum, blur, undo/redo, close, explicit sync, import);
- how the queue handles a second command while a write is pending;
- how write failure restores UI state without losing later commands;
- how a bulk import batches notifications and progress;
- how close waits for/declines pending writes;
- how an external modify is distinguished from an own write;
- conflict UX when external edits arrive during local dirty changes;
- crash/torn-write recovery and backup strategy, verified against actual Obsidian APIs.

Never assume a successful `Promise` means the file is durably recoverable after process termination; state only guarantees the API actually provides and test what can be tested.

### Step 5 — Handle multiple panes safely ✅ landed

Two leaves can open the same file. Choose one canonical shared repository per `databaseId`/resolved path, or implement explicit revision conflict detection between sessions; never leave two independent stores that silently overwrite each other. Test rename, close of one pane, close of last pane, and plugin unload. If Obsidian sync or external editor changes a document, refuse stale writes and present reload/keep-copy choices.

### Step 6 — Register and create the file view ✅ landed

Future plugin responsibilities:

- register one file-view type and the `.tablify` extension;
- create the view instance with a file-specific repository/session;
- create a new `.tablify` file via command/menu, then open it in a leaf;
- restore selected database/table/view through workspace state without mutating database contents on pane focus;
- support split/popup workspace leaves to the extent Obsidian’s verified lifecycle does;
- dispose view-scoped listeners and React rendering on unload;
- show a clear read-only/unsupported-version view for invalid/future documents rather than a blank grid.

Do not retain a global `liveViews` registry merely to recover a Bases leaf. Prefer public workspace/view APIs verified in the spike.

### Step 7 — Persist view state in the correct place ✅ landed

Landed as three things.

1. **`src/plugin/viewState.ts` — the split as data.** Every piece of view state is classified into one
   of three homes with a sentence a reviewer can hold it to: the `.tablify` document
   (`DOCUMENT_VIEW_STATE`, exhaustive over `keyof TableView`), plugin settings
   (`SETTINGS_VIEW_STATE`, exhaustive over `TablifySettings['appearance']`), or the workspace leaf
   (`WORKSPACE_VIEW_STATE`: the selected table and saved view). Both exhaustive records are typed, so
   adding a view key or a global appearance setting stops compiling until it is classified.
2. **The leaf state the file view writes.** `getState()`/`setState()` carry a selection, and
   selecting a table or a saved view is navigation: it re-renders and dispatches nothing. The panel
   shows the selected table's saved views as choices so the promise is exercised, not just stated.
3. **A schema correction this step forced into the open.** R1's reader preserved `density` and
   `frozenPrimary` as *unknown* keys, although `docs/03` §view config, `docs/R1` step 5 and the bullet
   above all list a view's density and pinned primary column as view content — and `docs/01`/`docs/04`
   build the freeze rule on them. They are now first-class: read (`short`/`medium`/`tall`, boolean),
   validated (`invalid-view-density`, `invalid-view-freeze`), written back, with absent meaning "the
   file did not say" so nothing is invented on save. The old expectation is replaced in
   `tests/unit/core-views.test.ts`, and the three-way agreement of the density vocabulary —
   document, plugin settings, grid pixels — is asserted rather than assumed.

**The negative half**, which is the part of this step that is a promise rather than a feature: the
native path (the file view, `viewState.ts`, and every file under `src/adapters/tablifyFile/**`) never
mentions a `.base` file, a Bases view, `registerBasesView`, `processFrontMatter`, a note-backed row
source or the metadata cache — checked by reading the sources in `tests/unit/view-state.test.ts`,
comments included, and by asserting that exactly one adapter file imports `obsidian` (the port's own
implementation). `main.ts` is excluded from that scan on purpose: the legacy Bases path still lives
there until R6 removes it.

- Named filters, sort/group, column visibility/order/width, density, freeze/pin, and per-table view options belong in the `.tablify` document.
- Global defaults (theme-following, motion preference, default row height) belong in plugin settings.
- Workspace selection (active database/table/view/leaf state) belongs in Obsidian workspace state if available and should not create document writes.
- No `.base` file is read or touched.

## File map (as landed)

- `src/adapters/tablifyFile/**` — `port.ts` (host-free file port), `revision.ts` (content revision),
  `session.ts` (one open document: parse/migrate, dispatch, flush, conflict, reload, keep-as-copy),
  `queue.ts` (one write per burst, mid-write edits never lost), `registry.ts` (one session per path,
  refcounted, rename-aware, create included), `vaultPort.ts` (the one file here that imports
  `obsidian`; `Vault` behind `FilePort`), `index.ts` (the folder's surface).
- `src/core/database/commands.ts` — the provisional id-addressed command seam R2 routes through; R3
  replaces it with the full operation model.
- `src/core/database/create.ts` — the valid minimum document `create()` writes.
- `src/plugin/TablifyFileView.ts` — `FileView` lifecycle, the R2 read-only panel, conflict choices,
  workspace-state selection. `src/plugin/main.ts` — view type, `.tablify` extension, the create
  command, the shared registry, teardown on unload.
- `src/plugin/viewState.ts` — where view state lives, as data (step 7).
- Tests: `tests/unit/{core-commands,tablify-session,tablify-write-queue,tablify-registry,vault-port,view-state}.test.ts`,
  `tests/dom/tablify-file-view.test.ts`, doubles in `tests/fakes/{tablifyFile,vaultFile}.ts`.
  The grid/React mount arrives in R4; this view shows the document and its state, not a grid.

## R2 test matrix and exit criteria

Each line says what is proven **here**, by a test that fails if it stops holding, and what is still
`NOT RUN` because only a device can answer it. The device half is one run of
[`probes/r2-file-view/`](../probes/r2-file-view/README.md), whose output goes into
[`manual-test-log.md`](manual-test-log.md) §"R2 — FileView probe kit".

- **Extension registration opens `.tablify` in the intended view, without Bases.** Registered by
  `Plugin.registerView` + `Plugin.registerExtensions` (`src/plugin/main.ts`); asserted in
  `tests/dom/tablify-file-view.test.ts` (the registered type, the claimed extension, and
  `canAcceptExtension` accepting `tablify` while refusing `md` and `base`). Whether Obsidian routes a
  double-click to it, keeps the leaf across a restart, and orders the `FileView` callbacks as the
  typings promise: **NOT RUN** (probe kit checks 1, 2, 7).
- **Create → edit → close/reopen preserves bytes, values, schema and views.** `tests/unit/tablify-registry.test.ts`
  (a created database parses with zero warnings; a created path is never overwritten) and the R1
  round-trip suites for what "preserves" means. An edit reaching the disk and surviving a reopen in
  the real app: **NOT RUN**.
- **Two panes cannot clobber a newer revision; close/unload releases everything.**
  `tests/unit/tablify-registry.test.ts` (one session per path, refcounted: the first close writes
  nothing, the last one saves and disposes, a rename re-keys the registry, two panes' edits in one
  burst are one write) and `tests/unit/tablify-write-queue.test.ts` (an edit landing mid-write gets
  its own pass; a burst that converges on the written bytes does not write twice). Two real leaves
  on one file, and what the app does with a disabled plugin's pending write: **NOT RUN** (check 5).
- **External edit, rename, delete, malformed file, future version and failed write are visible and
  non-destructive.** `tests/unit/tablify-session.test.ts` (ADR-0005 as code: revision compare,
  `conflict:{expected,found}`, reload never adopts unreadable text, keep-as-copy detaches) and
  `tests/dom/tablify-file-view.test.ts` (the three read-only failure panels, the conflict choices,
  the "changed on disk" status, and that none of those paths writes a byte). The same behaviours
  against a real vault and real Sync: **NOT RUN**.
- **One logical edit/bulk transaction is the intended number of writes, and one undo step.**
  `tests/unit/tablify-write-queue.test.ts` counts writes (`port.writes`) and flushes per burst; the
  **undo** half is R3's history work and is not claimed here. Measured write latency: **NOT RUN**.
- **Device tests cover the minimum supported versions before the floor moves.** `minAppVersion`
  stays `1.13.0` (ADR-0010) and the two device rows in `manual-test-log.md` are **NOT RUN**; no
  desktop evidence may speak for mobile.
- **No `.base` config, `BasesView`, `registerBasesView`, `processFrontMatter` or note-row identity in
  the native file view.** `tests/unit/view-state.test.ts` reads every native-path source and refuses
  all six, comments included; the same file asserts that exactly one adapter imports `obsidian`. The
  legacy Bases path is untouched by R2 and is removed by R6.
