# The Bases spike — how to run it

> **Historical/retired spike:** this probes the Bases integration that the confirmed target removes. Keep it only as evidence while planning; do not run it as a verification of the native `.tablify` file view. R6 plans its eventual removal after relevant findings are preserved.

A throwaway plugin that prints what Obsidian's Bases API actually does, so `docs/02` §Bases integration can be
verified instead of believed. **It is not part of the build.** `spike/**` is in `eslint.config.mts`'s
`globalIgnores`, it has its own `tsconfig.json` and its own build command, and nothing in `src/` may import
from here (`no-restricted-imports` bans the folder for every layer anyway).

**It is also the only folder in this repository that prints to the console on purpose.** Everywhere else,
numbers travel through test names and the JSON reporter (`AGENTS.md`).

## What you need

- Obsidian **1.13.0 or newer** (the API is `@since 1.10.0`; the plugin's `minAppVersion` is 1.13.0).
- The Bases core plugin **enabled** (Settings ▸ Core plugins ▸ Bases).
- A `.base` file with **at least two rows and a property called `status`** (or edit `PROBE_PROPERTY` at the top
  of `main.ts` to one your base has). A base file looks like:

  ```yaml
  views:
    - type: tablify-spike
      name: Spike
      order:
        - file.name
        - note.status
  ```

## Build it

From the repository root (it uses the root's `node_modules`):

```sh
cd spike/bases-path
bun build.mjs          # writes main.js (6.1 kB) next to main.ts
```

To check the types against the shipped declarations without building:

```sh
bunx tsc -p spike/bases-path
```

## Install it

1. Create `<your vault>/.obsidian/plugins/tablify-spike/`.
2. Copy `manifest.json` and the built `main.js` into it.
3. Settings ▸ Community plugins ▸ **Reload plugins** (or restart Obsidian), then enable **Tablify spike**.
4. Open the `.base` file and switch the view to **Tablify spike** (the view switcher sits in the Bases
   toolbar).
5. Open the developer console: `Ctrl/Cmd+Shift+I` ▸ Console.
6. Copy **every** `[tablify-spike]` line into `FINDINGS.md`, in order, verbatim.

## What to look for

| Line | The question it answers |
|---|---|
| `registerBasesView returned …` | Is Bases enabled in this vault? (`false` ⇒ the API is inert) |
| `container: … parent: …` | How much space the view gets, and whether its parent is sized — the layout contract |
| `config.getOrder(): …` | Does the toolbar's column order come through as prefixed property ids? |
| `config.getSort(): …` | Does `getSort()` return the user's sort config? |
| `entries: N first: …` | Does `data.data` hold the rows, and is the first one what you sorted first? |
| `property note.status: raw=… getValue=… ctor=…` | What the metadata cache holds next to what `getValue()` makes of it, and which class it returns |
| `createFileForView at runtime: function` | Is the sanctioned row-creation path really there? |

## The two write probes

Both are commands, run them from the command palette **with the spike view open**:

- **`Change "status" on the first row of the spike view`** — prints `about to change <path>` first, then the
  file's text before and after `processFrontMatter`. Paste both blobs into `FINDINGS.md`: the diff is the
  evidence that unknown keys, comments and formatting survive a write.
- **`Call createFileForView (opens a modal)`** — ⚠️ opens Obsidian's new-note modal. It reports what the
  promise does. Read the declaration's wording again: *"Display the new note menu for a file with the provided
  filename"* — which is why bulk note creation (the 412-row import) is **not** going to use it.

## When you are done

Delete this folder (`spike/`), remove `'spike/**'` from `eslint.config.mts`'s ignores, and fold the verified
facts into `docs/02` §Bases integration. The spike exists to be thrown away.
