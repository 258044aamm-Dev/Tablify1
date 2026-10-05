# 02 — Architecture

## Layers

```
src/
├─ core/                     pure TypeScript · no Obsidian · no React · no DOM
│  ├─ fieldTypes/            one file per field type + registry
│  ├─ query/                 AST, parser (query-string → AST), evaluator, comparator
│  ├─ ops/                   Op types + reducers (the only way state changes)
│  ├─ selection/             ranges, anchors, clipboard matrix model
│  ├─ schema/                property schema, column set, read-only resolution
│  └─ util/                  ids, dates, numbers, formatting
│
├─ adapters/                 data access · no React
│  ├─ RowSource.ts           the port (interface below)
│  ├─ bases/                 BasesSource: reads BasesView.data, writes frontmatter
│  ├─ tabulaFile/            LegacySource: the frozen .tabula format, read-mostly
│  └─ writeQueue.ts          coalescing, per-file serialization, rollback
│
├─ grid/                     React · the product
│  ├─ GridView.tsx           windowing, scroll, keyboard, drag
│  ├─ store.ts               hand-rolled store on useSyncExternalStore
│  ├─ selectors.ts           useCell / useRow / useSelection / useSchema
│  ├─ cells/                 one editor per FieldTypeId
│  ├─ overlays/              context menu, bulk-edit, conflict review
│  └─ styles/                tokens.css, brand.css, grid.css, editors.css
│
├─ import/                   CSV/TSV/HTML/XLSX → Matrix (pure) + preview model
├─ export/                   Matrix → TSV/XLSX/clipboard
│
├─ sync/                     dynamic-import only
│  ├─ SyncTarget.ts          port
│  ├─ airtable/              client + engine + conflict diff
│  └─ state.ts               .tablify/links/*.json read/write
│
└─ plugin/                   Obsidian glue, the only layer touching the app object
   ├─ main.ts                lifecycle, commands, settings tab
   ├─ basesView.ts           registerBasesView + view options
   ├─ legacyFileView.ts      .tabula TextFileView (thin, read + migrate)
   ├─ obsidian.ts            single re-export point for Menu/Modal/Notice/Setting
   └─ secrets.ts             SecretStorage wrapper for the Airtable token
```

Dependency direction is strictly one-way and lint-enforced (see `AGENTS.md`).

## The port: `RowSource`

The grid never learns where rows live. Two implementations exist and only one is ever "primary".

```ts
export type PropertyId = string;
export type RowId = string; // a TFile path in BasesSource; a row id in LegacySource

export interface RowSource {
  readonly kind: "bases" | "tabula-file";
  readonly writable: boolean;

  /** Column set, order, types and read-only flags. Cheap: called on every render pass. */
  getSchema(): PropertySchema;

  /** Rows in view order (already filtered/sorted/grouped by Bases or by core/query). */
  getRows(): readonly RowId[];

  /** Raw cell value in canonical (core) form. Must be O(1) and allocation-light. */
  getValue(row: RowId, prop: PropertyId): CellValue;

  /** Human-facing label for a row (used in titles, conflicts, migration reports). */
  getRowLabel(row: RowId): string;

  /** The single mutation entry point. Applies atomically and reports per-op results. */
  apply(ops: readonly Op[]): Promise<ApplyResult>;

  subscribe(listener: () => void): () => void;

  /** Resolves when every queued write has hit disk. Called on blur/close/undo. */
  flush(): Promise<void>;
}
```

Requirements for implementations:

1. `getValue` is called during render for thousands of cells — it must not allocate a new object per call, must not hit the vault, and must read from an in-memory snapshot that `subscribe` invalidates.
2. `apply` receives a batch and must be **all-or-nothing per file**, not per batch: a batch touching four notes either writes four notes or reports which ones failed, with the succeeded ones kept (partial success is reported, never hidden).
3. `subscribe` fires on external change (a user edits frontmatter in another pane, Bases re-queries, a file is renamed).

## The field-type registry

Replaces every `switch (field.type)` in the current codebase (~18 sites across 5 modules).

```ts
export interface FieldDescriptor<TValue = CellValue> {
  readonly id: FieldTypeId;                 // "currency"
  readonly label: string;                   // "Currency"
  readonly icon: string;                    // lucide name
  readonly editable: boolean;               // false ⇒ rendered read-only
  readonly defaultValue: TValue;

  /** Canonical value from a frontmatter-ish input. Never throws; returns a tagged error. */
  parse(raw: unknown, ctx: FieldContext): Parsed<TValue>;

  /** Canonical value → what actually gets written to frontmatter. */
  toYaml(value: TValue, ctx: FieldContext): unknown;

  /** Canonical value → what the cell shows. */
  formatDisplay(value: TValue, ctx: FieldContext): string;

  /** Canonical value → plain text for clipboard/TSV/export. */
  formatPlain(value: TValue, ctx: FieldContext): string;

  /** Plain text from a spreadsheet paste → canonical value. */
  parsePlain(text: string, ctx: FieldContext): Parsed<TValue>;

  /** Which filter operators apply; drives the filter UI and the query parser. */
  readonly filterOps: readonly FilterOpId[];
  matches(value: TValue, op: FilterOpId, operand: unknown, ctx: FieldContext): boolean;
  compare(a: TValue, b: TValue, ctx: FieldContext): number;
  groupKey(value: TValue, ctx: FieldContext): string;

  /** Which cell editor renders it. Defaults to id. */
  readonly editor?: EditorId;
  /** Per-field options (select colours, rating max, currency symbol) validated here. */
  readonly optionsSchema?: StandardSchemaV1;
}
```

Adding a field type must be: create one file, register it, add one editor component if the default does not fit, add tests. Nothing else.

## Query: one AST

```ts
export type Expr =
  | { kind: "and"; children: Expr[] }
  | { kind: "or"; children: Expr[] }
  | { kind: "not"; child: Expr }
  | { kind: "cmp"; prop: PropertyId; op: FilterOpId; value: unknown };

export function parseQueryString(input: string, schema: PropertySchema): Result<Expr, QueryError>;
export function toQueryString(expr: Expr): string;
export function evaluate(expr: Expr, row: RowView, schema: PropertySchema): boolean;
```

Bases owns filtering for Bases-backed views — this evaluator exists for (a) the legacy `.tabula` adapter, (b) local pre-filtering during paste/export, and (c) generating the filter description text. **There is no separate free-text `search` concept**: search is sugar that parses into a `contains` expression. The three overlapping filter systems in the old codebase are reduced to one AST plus a parser.

## Store

No external state library. One store instance per open view.

```ts
export interface GridSnapshot {
  readonly revision: number;     // bumps on data change
  readonly active: CellRef | null;
  readonly anchor: CellRef | null;   // range anchor
  readonly editing: CellRef | null;
  readonly pending: PendingOverlay;   // optimistic values not yet on disk
  readonly busy: boolean;             // a batch write is in flight
}

export interface GridStore {
  getSnapshot(): GridSnapshot;
  subscribe(listener: () => void): () => void;
  dispatch(command: Command): void;
  undo(): Promise<void>;
  redo(): Promise<void>;
  canUndo(): boolean;
}
```

- Components subscribe with `useSyncExternalStore(store.subscribe, () => store.getSnapshot().editing === ref)` style **narrow selectors** so typing in one cell does not re-render the grid.
- The store is framework-free (`store.ts` has no React import); only the hooks in `selectors.ts` know React.
- **Command log for undo/redo:** a `Command` captures the ops it produced *and the previous values it overwrote*. Undo replays inverse ops through the same write queue, so an undo of a 400-cell paste is one queued batch, not 400 keystroke-level writes.
- Rendering cost rule: a keystroke may re-render the edited cell and, at most, the row. Never the grid.

## Grid rendering

- **Row windowing, hand-rolled (~150 LOC).** Row heights are enumerated and fixed per density (short 32 / medium 40 / tall 64), so visible range is arithmetic on `scrollTop` — no measurement pass. Overscan 8 rows.
  *Why not a virtualizer dependency:* uniform fixed heights plus a single scroller is the easy case; the cost is two dozen lines of range math, and every kilobyte matters for Obsidian mobile startup. If variable heights are ever required, add `@tanstack/react-virtual` and record it as a decision.
- **Column windowing** only when the visible column count exceeds 40; keyed by cumulative width.
- DOM: a `div` scroll container holding a spacer for total height and absolutely-positioned rows. **Not a `<table>`** — the old build's `<table>` + `position: sticky` approach is what made frozen columns, resize and drag fight each other. Sticky header and frozen first column are separate absolutely-positioned layers inside the same scroll container, offset by `scrollTop`/`scrollLeft` in a `requestAnimationFrame`, applied via CSS transform (never a layout-triggering property).
- Interactions: one `pointerdown/move/up` handler on the container for resize and reorder drags (pointer capture, no document listeners), one keyboard handler scoped to the grid element.
- Reuse: rows are keyed by `RowId`; when the row set changes identity (filter/sort), rows are recycled rather than remounted where the id is unchanged.

## Write queue

The correctness core of "rows are notes".

```
dispatch(Command)
  → core/ops reducer produces Op[] (+ previous values for undo)
  → optimistic overlay updated, store revision bumped, UI paints immediately
  → writeQueue.enqueue(ops)
       ├─ coalesce per (file, property): last write wins within a tick
       ├─ batch by file: one processFrontMatter call per file per flush
       ├─ serialize per file: a promise chain keyed by path (never two writers per file)
       ├─ debounce 250 ms, hard flush on blur / view close / undo / import
       └─ on failure: drop the overlay for those ops, Notice(file, reason), keep UI truthful
```

Rules:
- **Never** `vault.modify()` a note to change one property — `fileManager.processFrontMatter()` only, so concurrent edits from other panes are respected.
- Unknown frontmatter keys are **preserved**; the plugin only touches properties it owns or that the view exposes.
- Deleting a property across a view is a bulk multi-file operation with a preview and its own progress UI — not a synchronous loop.

## Bases integration

```ts
// plugin/basesView.ts
export const VIEW_TYPE = "tablify-grid";

export class TablifyBasesView extends BasesView {
  readonly type = VIEW_TYPE;
  onDataUpdated(): void { ... }   // re-derive from this.data, then reconcile selection
}

// registration (signature verified: returns false when Bases is disabled in the vault)
const ok = this.registerBasesView(VIEW_TYPE, {
  name: "Tablify grid",                // final display name per brand pass
  icon: "lucide-table-2",
  factory: (controller, container) => new TablifyBasesView(controller, container),
  options: () => [ /* rowHeight, frozenFirstColumn, showRowNumbers, density */ ],
});
if (!ok) new Notice("Enable the Bases core plugin to use Tablify's grid.");
```

**Verified API facts (read directly from `obsidian.d.ts` @ 1.13.1 — see `docs/10-verification-and-ai-hygiene.md`):**

- `BasesEntry` exposes exactly two members: `file: TFile` and `getValue(propertyId): Value | null`. **There is no write API.** Writing therefore goes through `fileManager.processFrontMatter()` — this is the load-bearing fact of the whole design.
- `BasesView.data: BasesQueryResult` is **replaced wholesale on every update**, and the contained `BasesEntry` objects are recreated. Never hold a reference to an entry or to `data` across renders; key everything by `entry.file.path` and re-derive on each `onDataUpdated`.
- `QueryController` is an **empty class** in the public types. All data must come from `BasesView.data` (`data`, `groupedData`, `properties`, `getSummaryValue`).
- Column order and sorting are the user's: `config.getOrder(): BasesPropertyId[]` and `config.getSort(): BasesSortConfig[]`, and `data` arrives **presorted**. Do not re-sort unless the user asks the grid to.
- Property ids are prefixed (`note.Status`, `file.name`, `formula.foo`). Everything the plugin stores or compares uses the prefixed form.
- Row creation has a sanctioned path: `createFileForView(baseFileName?, frontmatterProcessor?)` (`@since 1.10.2`).
- Our per-field metadata goes through `config.set("fieldOptions", …)` — the documented "store configuration data for the view" mechanism.

- View options persist in the `.base` file via Bases' own option mechanism (`BasesViewRegistration.options: (config) => BasesAllOptions[]`), so column layout choices travel with the base.
- `onDataUpdated` is called by Obsidian on any vault/config change that affects the query. Reconciling must be cheap and must not drop the user's selection when the row set is unchanged (compare by file path).
- Pop-out windows and embedded bases (`![[x.base#view]]`) are supported surfaces, not afterthoughts: the view factory is stateless per instance.

## Legacy `.tabula` surface

A thin `TextFileView` registered for the `.tabula` extension, which:
- opens the file read-only in the grid with a banner: "Legacy file — migrate to notes", and a one-click migration command;
- keeps the old behaviour available for non-note data (the documented escape hatch for huge imports);
- is excluded from all new features. No new field types, no new UI, no format extensions.

## Sync

- `sync/` is only ever reached through `await import("../sync/…")`, so Obsidian's startup never parses it.
- Pull: Airtable records → per-field diff against local values → user decision → ops → write queue.
- Push: local values → Airtable batch endpoints (`PATCH /records` in chunks of 10 with retry/backoff) → update `recordMap`.
- `SyncTarget` is a port like `RowSource`, so the conflict UI and the queue are provider-agnostic.

## Performance budget

| Budget | Target | Enforced by |
|---|---|---|
| Production `main.js` (before gzip) | ≤ 900 KB total; ≤ 250 KB for non-React code | `bun run build` size report in CI |
| Lazy chunk: sync | ≤ 40 KB | build report |
| Startup work | No vault scan, no network, no JSON parse of large files | code review + startup timing test |
| Keypress → paint | ≤ 1 frame; no full-grid re-render | layout harness typing trace |
| Window of 60 visible rows, 20 columns | ≤ 1,200 mounted cells | harness assertion |
| 5,000-row view open | ≤ 300 ms to first paint | harness timing |

## Error handling

- One `Logger` (`src/plugin/log.ts`) with a `[tablify]` prefix; `console.error` only — **no telemetry, ever** (developer policy and a listing requirement).
- Recoverable user errors → `Notice` naming the file and the reason; never a silent catch.
- Adapter failures are surfaced as `ApplyResult` items; the store reports the count, the UI marks affected cells.
- Every `register*` API is used for anything with a lifetime: `registerEvent`, `registerDomEvent`, `registerInterval`, `addChild`. The old build's uncleaned `MutationObserver` and raw listeners do not get a second life here.
