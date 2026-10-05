# Running Tablify against a scratch vault

One page, for the person who has to look at this build with their own eyes. Everything below was checked
against the code in this repository at step 12; the parts that have **not** been checked against Obsidian are
marked **ASSUMED**, and step 12's report says which they are.

## 1. Put the build where Obsidian looks

```sh
bun install --frozen-lockfile
bun run build                 # esbuild → main.js (and styles.css is copied by release-assets)
bun scripts/release-assets.ts # dist/<version>/ = main.js + manifest.json + styles.css, exactly three files
```

Copy those three files into:

```
<vault>/.obsidian/plugins/tablify/
├── main.js
├── manifest.json
└── styles.css
```

The folder name must equal `manifest.json`'s `id` (`tablify`), or Obsidian will not load the plugin.
Then: **Settings ▸ Community plugins ▸ Installed plugins ▸ enable Tablify**, and after every rebuild click
**Reload app without saving** (`Cmd/Ctrl+R`) so Electron re-reads `main.js`.

`minAppVersion` is `1.13.0`, so the Bases view type only registers on Obsidian 1.13 and later. If
`registerBasesView` returns `false`, Bases is switched off in that vault; the plugin loads and simply has no
view to offer.

## 2. The scratch vault

Four notes, one folder, one `.base`. Values on purpose include a missing one (`Owner`), a clearable one
(`Status`) and a list (`Tags`), so the read and write paths both have something to say.

```
Projects/
├── Alpha.md      ---\nName: Alpha\nStatus: Todo\nOwner: Dana\nTags: [ship]\n---
├── Beta.md       ---\nName: Beta\nStatus: Doing\nOwner: Ravi\n---
├── Gamma.md      ---\nName: Gamma\n---            (no Status, no Owner)
└── Delta.md      ---\nName: Delta\nStatus: Done\nOwner: Dana\n---
Projects.base     (below)
```

`Projects.base` — the plugin's view type is `tablify-grid`:

```yaml
filters:
  and:
    - 'file.inFolder("Projects")'
views:
  - type: tablify-grid
    name: Projects
    order:
      - note.Name
      - note.Status
      - note.Owner
    sort:
      - property: note.Name
        direction: ASC
```

To make the second column a **select** rather than text (option colours, and the sidecar's job), open the
view's field settings once the toolbar exists — or, today, hand-write the sidecar entry the plugin writes:

```
fieldOptions = {"version":1,"fields":{"note.Status":{"type":"singleSelect","options":[{"id":"o1","name":"Todo"}]}}}
```

## 3. The three things to click

1. **Open `Projects.base`, then switch the view to “Tablify grid”** (the view-type picker at the top of the
   base, or the base's own `views[].type` above). Expected: a plain block of text, because step 12's body is
   a deliberately ugly placeholder. The first line reads
   `4 rows × 3 columns`, followed by one line per row beginning `Projects/Alpha.md: note.Name=Alpha, …`.
2. **Change a property from inside the view.** Add the temporary command the step's acceptance asks for:

   ```ts
   this.addCommand({
       id: 'spike-set-cell',
       name: 'Spike: set one cell',
       callback: () => {
           const view = /* the live TablifyView */;
           void view.rowSource.apply([
               { kind: 'setCell', filePath: 'Projects/Alpha.md', fieldId: 'note.Owner', value: 'Sam' },
           ]);
       },
   });
   ```

   Run it from the command palette, then look at two things: the placeholder's status line says
   `last write: 1 cell(s) to 1 file(s)`, and **the note's frontmatter** gains `Owner: Sam` with `Name`,
   `Status` and `Tags` untouched. The write is debounced 250 ms and goes through
   `fileManager.processFrontMatter`, so an open editor pane shows the same value without a reload.
3. **Open a second pane on the same base and edit a note in the file explorer.** The view's summary should
   follow the vault within a frame or two; the plugin adds no `window` listener, and the only outside
   subscription it holds is the app's own `metadataCache` `changed` event, released when the view closes.

**Delete the `spike-set-cell` command in the same commit that adds it.** It exists to produce the
before/after frontmatter evidence for step 12's report and for nothing else.

## What this build does not do yet

- No grid: no cells, no selection, no keyboard. Steps 15 and 17.
- No settings surface of its own: `Settings ▸ Tablify` is still step 04's tab.
- No undo/redo wiring: `core/ops/history.ts` is complete and tested, but nothing calls it until step 18.
