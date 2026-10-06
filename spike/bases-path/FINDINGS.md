# Step 10 — the Bases spike: findings

> **Historical API evidence for the retired Bases path:** these findings do not verify custom FileView APIs or native `.tablify` persistence. Preserve this record only; future R2 work must use pinned declarations and its own app proof.

**Status: HALF RUN, and honestly labelled.** The declaration half is finished and verified against the shipped
types. The runtime half **cannot be run from the agent's environment** — it needs a real Obsidian vault, a real
`.base` file and a human at the keyboard — so every row that needs a running app says `PENDING-RUN` with the
exact command that produces it. **Step 11 stays gated on the human confirming this report**, as
`../../docs/reference/archive/bases-first-prompts-2026-10/step-10-bases-spike.md` requires.

- Declarations read from: `node_modules/obsidian/obsidian.d.ts`, version **1.13.1** (root devDependency;
  `node -e "require('./node_modules/obsidian/package.json').version"` → `1.13.1`).
- Spike typecheck, run here: `bunx tsc -p spike/bases-path` → **exit 0**.
- Spike build, run here: `bun spike/bases-path/build.mjs` → `main.js 6.1kb`, bundle 4 ms.
- Runtime evidence: **PENDING-RUN** (see "How to finish this report").

## The claim table

Every claim `docs/02` §Bases integration makes, against what was checked. `VERIFIED` = read in the declaration
above, with the line number as evidence. `PENDING-RUN` = needs the running app.

| # | Claim (from `docs/02` §Bases integration) | Observed | Verdict | Evidence |
|---|---|---|---|---|
| 1 | `registerBasesView` exists and registers a view type | `registerBasesView(viewId: string, registration: BasesViewRegistration): boolean` — `@since 1.10.0` | **VERIFIED** | `obsidian.d.ts:5009` |
| 2 | …and returns `false` when Bases is disabled in the vault | The doc comment says exactly that: "@returns false if bases are not enabled in this vault" | **VERIFIED** | `obsidian.d.ts:5005-5009` |
| 3 | Registration takes `{ name, icon, factory, options? }` | `BasesViewRegistration{name: string; icon: IconName; factory: BasesViewFactory; options?: (config) => BasesAllOptions[]}` — all `@since 1.10.0` | **VERIFIED** | `obsidian.d.ts:1254-1277` |
| 4 | The factory is `(controller, container) => BasesView` | `type BasesViewFactory = (controller: QueryController, containerEl: HTMLElement) => BasesView` | **VERIFIED** | `obsidian.d.ts:1247` |
| 5 | Extend `BasesView` and implement `type` + `onDataUpdated()` | `abstract class BasesView extends Component` — `abstract type: string`, `abstract onDataUpdated(): void`, `protected constructor(controller: QueryController)` | **VERIFIED** | `obsidian.d.ts:1105-1149` |
| 6 | `BasesView.data: BasesQueryResult` is replaced wholesale on every update | The declaration says so in as many words: "will be replaced with a new result set when changes to the vault or Bases config occur … contained BasesEntry objects will be recreated" | **VERIFIED** | `obsidian.d.ts:1131-1137` |
| 7 | `config.getOrder(): BasesPropertyId[]` | Present, `@since 1.10.0`: "Ordered list of properties to display in this view … configured by the user through the properties toolbar menu" | **VERIFIED** | `obsidian.d.ts:1213` |
| 8 | `config.getSort(): BasesSortConfig[]` | Present, `@since 1.10.0`, and it adds: "Note that data from BasesQueryResult will be presorted" | **VERIFIED** | `obsidian.d.ts:1225` |
| 9 | **`BasesEntry` has no write path** — writes go through `processFrontMatter` | `class BasesEntry implements FormulaContext { file: TFile; getValue(propertyId: BasesPropertyId): Value | null }` — those are the only two declared members; no `set`, no `update`, no `write` | **VERIFIED** | `obsidian.d.ts:685-702` |
| 10 | `BasesQueryResult` carries `data`, `groupedData`, `properties`, `getSummaryValue` | All four present; `data: BasesEntry[]` ("Where appropriate, views should support groupBy by using `groupedData`") | **VERIFIED** | `obsidian.d.ts:971-1001` |
| 11 | `QueryController` is an empty class | `export class QueryController extends Component { }` — no members at all, so nothing may be called on it | **VERIFIED** | `obsidian.d.ts:5315-5317` |
| 12 | Row creation has a sanctioned path: `createFileForView(baseFileName?, frontmatterProcessor?)`, `@since 1.10.2` | Present with exactly that signature — but the doc comment reads "**Display the new note menu** for a file with the provided filename", i.e. it opens a modal | **VERIFIED, with a caveat** | `obsidian.d.ts:1151-1156` |
| 13 | `app.fileManager.processFrontMatter(file, fn, options?)` | Present, `@since 1.4.4` | **VERIFIED** | `obsidian.d.ts:2954` |
| 14 | `BasesView` exposes `containerEl` | **It does not.** The container is handed to the factory and nowhere else; the view must keep its own reference | **DIFFERENT from what a view class usually offers** | `obsidian.d.ts:1105-1158` (no `containerEl` member) |
| 15 | Property names come through prefixed (`note.Status`, `file.name`) | `BasesPropertyId` is the type used for `getOrder()`/`getValue()`, and `config.getDisplayName(propertyId)` exists to humanise one | **VERIFIED** | `obsidian.d.ts:1213, 1236` |
| 16 | The value `getValue()` returns is a `Value` subclass | `getValue(): Value | null`, and `abstract class Value` is the base of the class hierarchy (`@since 1.10.0`) | **VERIFIED** | `obsidian.d.ts:699, 7246` |
| 17 | The container is sized sensibly at mount, and its parent too | `PENDING-RUN` — this is the layout contract step 17 depends on | — | console line `container: … parent: …` |
| 18 | `registerBasesView` really returns `true` in a vault with Bases on | `PENDING-RUN` | — | console line `registerBasesView returned …` |
| 19 | `createFileForView` exists at runtime (declared, but appears at 1.10.2) | `PENDING-RUN` | — | console line `createFileForView at runtime: …` |
| 20 | `getOrder()` reflects the toolbar order for a real base | `PENDING-RUN` | — | console line `config.getOrder(): …` |
| 21 | A `processFrontMatter` write preserves unknown keys, comments and formatting | `PENDING-RUN` — `docs/03` §write rules depends on it | — | the before/after text from the write command |
| 22 | The Obsidian version in use | `PENDING-RUN`, and **the public API does not expose it** (checked: there is no version member on `App`/`Vault` in the types; the spike's command says so). Read it from Settings ▸ About and paste it below | — | manual |

## What the spike does not test, and why

- **Anything on a phone.** `isDesktopOnly: false` is in the spike's manifest, but no mobile device was
  available. The mobile layout questions (the 389 px pane, touch targets) are Tier 5 in `docs/07`, and step 17's
  layout harness is the automated half of them.
- **`registerBasesView` with `options`.** The registration in `main.ts` deliberately omits the `options`
  callback: the spike is about the data path, and `docs/02`'s option list (`rowHeight`, `frozenFirstColumn`,
  `showRowNumbers`, `density`) is step 17's business.
- **Embedded bases and pop-out windows** (`![[x.base#view]]`). They need a second vault surface; the factory is
  stateless per instance, which is what makes them plausible, but that is untested here.

## The proposed doc correction

`docs/02` §Bases integration is accurate on everything that could be checked from the declarations — it was
written from the same file, and claims 1–13 and 15–16 all hold verbatim. The one thing it does not say, and
should, is that **`BasesView` has no `containerEl`**: the only container the API hands a Bases view is the
`containerEl` argument of the factory (`obsidian.d.ts:1247`), and the view's own class is where it has to be
kept. One sentence, after the registration snippet:

> **`BasesView` declares no `containerEl`.** The view's DOM container arrives once, as the second argument of the
> `BasesViewFactory`, and the view must keep its own reference to it (`obsidian.d.ts:1247`, and no `containerEl`
> member on `BasesView` at `1105-1158`).

The second candidate correction is smaller and belongs in `docs/03` §Import rather than `docs/02`: the
declaration's own wording for `createFileForView` is *"Display the new note menu for a file"* — it is a **menu**,
so it is the right path for a "New row" button and the wrong path for creating 412 notes during an import
(that needs `vault.create` plus `processFrontMatter`, which is what step 13 already plans).

## How to finish this report

```sh
cd spike/bases-path && bun build.mjs
# copy manifest.json + main.js into <vault>/.obsidian/plugins/tablify-spike/
# enable it, open the .base (enabled: true), read the console, paste every [tablify-spike] line below
```

1. **Raw console output** — paste below, in order, verbatim.

```
(paste here)
```

2. **The write test's before/after text** — run the command `Change "status" on the first row of the spike
   view`, then paste both blobs.

```
before:

after:
```

3. **The environment.**

```
Obsidian version (Settings ▸ About):
Platform (from the version command):
Desktop / mobile:
Vault size (roughly how many notes):
```

Then flip rows 17–22 of the claim table from `PENDING-RUN` to `VERIFIED` or `DIFFERENT`, and say what should
change in `docs/02` if anything does. `PROGRESS.md`'s step-10 entry lists this as the one open question.
