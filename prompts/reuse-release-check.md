Review a proposed release package against the actual code and current repository state. Do not change files. This prompt is usable only after implementation and release work are separately authorized.

Check:
1. `manifest.json`, `package.json`, `versions.json`, changelog, and proposed git tag match exactly; preserve the existing `0.1.0` tag.
2. Release assets are built from the reviewed commit and attached separately.
3. `bun run check`, `bun run test:layout`, bundle/CSS/contrast/manifest/brand gates have actual results.
4. `.tablify` file view opens in a fresh vault with Bases disabled; multi-table/links/import/export have smoke evidence.
5. Desktop and physical-phone checks are recorded in `docs/manual-test-log.md`; `NOT RUN` is not treated as pass.
6. No `.base`/`.tabula` migration or compatibility promise appears; no old data is rewritten.
7. Airtable remains manual; token is in `SecretStorage`; no token or unapproved network endpoint appears in release artifacts/logs.
8. README and manifest/package descriptions match what ships, not roadmap items.

Return `CLEAR` or `BLOCKED — <reason>` with evidence. Do not tag or publish.
