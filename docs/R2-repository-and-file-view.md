# R2 — Database repository and Obsidian file view

**Mode:** implementation guide. Authorized for implementation 2026-10-07 (see [`08-decisions.md`](08-decisions.md) §Implementation authorization log): steps commit and push one at a time on `refactor/native-tablify`. **Status:** in progress — steps marked ✅ are implemented, gated and pushed; implementation state is always the source at HEAD. **Dependencies:** R1 schema frozen (✅ complete); Obsidian API assumptions are checked against the pinned typings ([`10-verification-and-ai-hygiene.md`](10-verification-and-ai-hygiene.md) §Required claims ledger) and, for the app-version question, by the user-run probe kit in [`probes/r2-file-view/`](../probes/r2-file-view/README.md) — never claimed from typings alone (ADR-0010). **Blocking decisions:** ADR-0005 (external edit, never a silent overwrite), ADR-0010 (app-version floor stays at 1.13.0 until the probes report).

## Objective

Make a `.tablify` document open as an Obsidian-native file view, and provide a safe in-memory repository for its data. This replaces `TablifyView extends BasesView`, the Bases registration path, note-backed sources, and `.base`-owned view config.

## Why this is a separate phase

The document is one multi-table write unit. The current `RowSource` assumes a single table and note-path row IDs, while current writes are queued by Markdown file and use frontmatter. A `.tablify` edit must serialize the database document without losing a concurrent pane’s or Obsidian Sync’s newer revision. Do not claim R2 is complete by only registering a file extension.

## Step-by-step plan

### Step 1 — Verify the host API surface

Read `node_modules/obsidian/obsidian.d.ts` from the repo’s pinned `obsidian@1.13.1` and the official Obsidian custom-view docs. The documented direction is `registerView` plus `registerExtensions`; exact callbacks/lifecycle must be verified for the oldest supported app version.

Before product changes, create a tiny throwaway API proof (future implementation task, not this documentation task) that:

- registers a view type and maps the `tablify` extension to it;
- opens a generated `.tablify` file in a scratch vault;
- receives the file-load and unload/lifecycle events;
- handles rename and close safely;
- writes a text change through an Obsidian-notifying vault API and observes the modify event;
- works on the actual minimum desktop and mobile Obsidian versions selected for release.

Do not copy the old Bases spike or assume `registerExtensions` alone is the whole file-view lifecycle. Record symbol, signature, `@since`, test app versions, output, and any differences in the claim ledger.

### Step 2 — Separate database lifetime from grid lifetime

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

### Step 3 — Specify the file I/O port

Introduce an injectable text-file port (name to be chosen in implementation) with operations for read, create, write/replace, event subscription, rename/delete handling, and optional recovery/backup. The unit tests use an in-memory fake. The real adapter uses a documented Obsidian-supported API that notifies the vault; verify exact guarantees instead of reaching around it with an untracked raw write.

File rules:

- New database creation writes a valid minimum `.tablify` document before asking Obsidian to open it.
- File path is an address, not the database ID. Rename updates the session path without changing database/table/row identity.
- Preserve the last known-good text/snapshot on parse/write failure; do not overwrite a damaged file with defaults.
- The host can offer a copy/export of corrupt text for recovery, but the core parser never writes it.

### Step 4 — Define a document-level write queue

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

### Step 5 — Handle multiple panes safely

Two leaves can open the same file. Choose one canonical shared repository per `databaseId`/resolved path, or implement explicit revision conflict detection between sessions; never leave two independent stores that silently overwrite each other. Test rename, close of one pane, close of last pane, and plugin unload. If Obsidian sync or external editor changes a document, refuse stale writes and present reload/keep-copy choices.

### Step 6 — Register and create the file view

Future plugin responsibilities:

- register one file-view type and the `.tablify` extension;
- create the view instance with a file-specific repository/session;
- create a new `.tablify` file via command/menu, then open it in a leaf;
- restore selected database/table/view through workspace state without mutating database contents on pane focus;
- support split/popup workspace leaves to the extent Obsidian’s verified lifecycle does;
- dispose view-scoped listeners and React rendering on unload;
- show a clear read-only/unsupported-version view for invalid/future documents rather than a blank grid.

Do not retain a global `liveViews` registry merely to recover a Bases leaf. Prefer public workspace/view APIs verified in the spike.

### Step 7 — Persist view state in the correct place

- Named filters, sort/group, column visibility/order/width, density, freeze/pin, and per-table view options belong in the `.tablify` document.
- Global defaults (theme-following, motion preference, default row height) belong in plugin settings.
- Workspace selection (active database/table/view/leaf state) belongs in Obsidian workspace state if available and should not create document writes.
- No `.base` file is read or touched.

## Future file map

- `src/adapters/tablifyFile/**`: read, write, validation handoff, queue, revision tracking, fakeable file port.
- `src/plugin/TablifyFileView.ts` or equivalent: `FileView` lifecycle, React mount, status/errors.
- `src/plugin/main.ts`: register extension/view, commands, shared repository/session manager.
- `src/core/database/**`: document model and operations from R1/R3.
- Tests: parser/repository unit suites, fake vault/file port, plugin registration/lifecycle DOM tests, layout harness opening from a fixture repository.

## R2 test matrix and exit criteria

- Extension registration opens `.tablify` in the intended view in real Obsidian, without enabling Bases.
- Create → edit multiple tables → close/reopen preserves bytes/values/schema/views.
- Two panes opening the same file cannot clobber a newer revision; close/unload releases all resources.
- External edit, rename, delete, malformed file, unsupported future version, and failed write have visible, non-destructive behavior.
- One logical edit/bulk transaction is reflected in the intended number of file writes and one undo step; measured write latency is recorded.
- Device tests cover at least the minimum supported desktop and mobile app versions before lowering or retaining `minAppVersion`.
- No `.base` config, `BasesView`, `registerBasesView`, `processFrontMatter`, or note-row identity is used by the native file view.
