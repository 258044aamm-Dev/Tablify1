Run the release checklist and report the result, before I tag anything. Nothing in this turn changes
behaviour: if you find something that needs a fix, report it as a blocker and stop.

Check, in this order, and paste the evidence for each:

1. **Version consistency** — the version in `manifest.json`, `package.json`, the top `CHANGELOG.md` heading,
   and the newest `versions.json` key are the same string; the tag I am about to create equals it with no
   `v` prefix. Paste each value and the comparison.
2. **Assets** — a production build produces exactly three files, in the layout Obsidian expects, with the
   sizes and checksums; `bun run size` is within budget; `styles.css` contains no `!important`.
3. **The gates** — `bun run check`, `bun run test:layout` (all five viewports), `bun run contrast`,
   `bun run brand:gate`, `bun run manifest:check`, each pasted raw. Any red ends this turn.
4. **Installability** — the plugin installs into a clean vault from the release assets alone (not from the
   source tree), enables without an error in the console, and shows the version. Paste the console.
5. **The docs a reviewer reads** — `README.md` has the network-use disclosure, the install steps, the
   limitations and the licence lines; `LICENSE` and `NOTICE` exist and are accurate; the manifest
   description respects the length and the naming rules.
6. **The privacy pass** — `grep` the repository (excluding `prototype/`, `docs/`, `node_modules/`) for
   token-shaped strings, `api.airtable.com` outside the sync module, telemetry words
   (`analytics`, `telemetry`, `track`, `sentry`), `fetch(` outside the allowed path, and any
   `eval`/`Function(` construction or obfuscated string. Paste the command and its output for each.
7. **The behaviour smoke on the released build** — in a clean vault: open a base, edit a cell, undo it,
   import a small CSV, export it as TSV, and migrate a `.tabula` fixture. Each PASS/FAIL with one line.
8. **Rollback** — state exactly what to do if the release is bad after tagging (which files, which
   commands, whether a new patch version is required), in five lines or fewer.

End with a verdict line: `CLEAR TO TAG` or `BLOCKED — <the blocker>`.
