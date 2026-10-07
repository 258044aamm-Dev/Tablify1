# R2 FileView probe kit — run this in a real Obsidian, desktop and phone

This folder is a **throwaway evidence kit**, not the Tablify plugin and not part of its build. It
exists because two claims R2 rests on cannot be proven from `node_modules/obsidian/obsidian.d.ts`:

- **ADR-0010:** which FileView APIs exist and work on the oldest app version we support, on **both**
  desktop and phone. The typings say `@since 0.9.7` for `registerView`, `registerExtensions`,
  `FileView.onLoadFile/onUnloadFile/onRename` and `setState`; the app decides whether they work.
- **ADR-0005:** whether a write through a vault API actually notifies the vault (`modify`). The save
  path's conflict detection leans on being able to tell our own write from someone else's.

Until the log from this kit exists, every plugin-layer behaviour in R2 is `NOT RUN`
(`docs/manual-test-log.md`, `docs/10-verification-and-ai-hygiene.md` §5).

## What you need

- A **scratch vault** (or a vault where the real Tablify plugin is disabled — two plugins registering
  the `.tablify` extension would both fight for the file type).
- Obsidian at the floor version (`minAppVersion` 1.13.0) or newer, on desktop **and** on your phone.
- This folder copied into `<vault>/.obsidian/plugins/tablify-r2-probe/` (the folder must contain
  `manifest.json` and `main.js`).

## Run it

1. Enable **Tablify R2 probe (throwaway)** in Settings → Community plugins.
2. Open the developer console (desktop: Ctrl/Cmd+Shift+I) **and** keep the vault file
   `R2-probe-log.md` — the probe appends every line to it, which is how you collect the log on a phone.
3. Run these commands (Ctrl/Cmd+P → "R2 probe: …"), in order:
   | # | Command | What its log lines prove |
   |---|---|---|
   | 1 | Create and open the probe `.tablify` file | registration + extension routing; `onLoadFile`; the view can read and parse the file |
   | 2 | Write through the vault API (modify) and wait for the event | a `vault modify:` line after the write = the write notifies |
   | 3 | Open the probe file in a new leaf | a second leaf on the same file works |
   | 4 | Rename the probe file (tests onRename) | `vault rename` + `onRename` fire; the view follows the file |
   | 5 | Close every probe leaf (tests onUnloadFile) | `onUnloadFile` + `view onClose`; no leftover leaf |
   | 6 | Disable the plugin | `probe unloaded`, no errors |
4. Copy **all** of `R2-probe-log.md` (plus the app version line) into
   `docs/manual-test-log.md` §"R2 — FileView probe kit", desktop and phone rows separately.
5. Delete the probe folder and the two probe files; nothing in this kit touches your real notes.

## What a good log looks like (shape, not content — your app fills it in)

```
- [...] probe loaded — app version 1.14.x, platform desktop
- [...] vault.read: present
- [...] vault.create: present
- [...] vault.modify: present
- [...] vault.process: present            <- MISSING here would change the R2 save path
- [...] vault.append: present
- [...] registered: view type + .tablify extension
- [...] created R2-probe.tablify
- [...] opening R2-probe.tablify in a new leaf (leaf ok)
- [...] onLoadFile: R2-probe.tablify
- [...] parsed: format=tablify version=1 tables=1
- [...] vault modify: R2-probe.tablify    <- after command 2; absence = writes do not notify
- [...] vault rename: R2-probe.tablify -> R2-probe-renamed.tablify
- [...] onRename: R2-probe-renamed.tablify
- [...] onUnloadFile: R2-probe-renamed.tablify
- [...] view onClose
```

## Red flags to report, not work around

- The `.tablify` file opens as **plain text** → extension routing failed on that app version.
- The view opens but **no `onLoadFile`** line → the lifecycle differs from the typings; R2's view
  must not assume it.
- **No `vault modify:` line** after command 2 → writes through `vault.modify` do not notify on that
  platform; ADR-0005's "our write vs theirs" detection needs a different signal there.
- An error on **command 3** (second leaf) or a crash on **command 6** (disable) → multi-pane or
  unload behaviour needs a different design before R2 claims it.
- Anything that only reproduces on the phone: that is the point of running it there. Desktop
  evidence never speaks for mobile (ADR-0010).

## Why a throwaway kit rather than the plugin

The plugin is not allowed to claim any of this before the evidence exists
(`docs/10` §7: stop before making claims about FileView/write guarantees). A 200-line probe that can
fail without consequence is the smallest honest way to get the answer, and it keeps the plugin's
first release free of unverified assumptions.
