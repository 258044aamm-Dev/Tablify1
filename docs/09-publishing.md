# 09 — Publishing

## Submission mechanics (2026)

Submissions go through the **`community.obsidian.md` dashboard**: sign in with an Obsidian account, link GitHub, choose **Plugins → New plugin**, enter the repo URL, accept the developer policies. An automated security and policy review gates the listing (usually minutes); on pass the plugin is searchable in-app within about a day. The old route (a PR to `obsidianmd/obsidian-releases`) is retired.

Requirements the automated review checks:

| Requirement | Our state |
|---|---|
| Repo is dedicated to this plugin | ✅ fresh `tablify` repo |
| `manifest.json` with `id`, `name`, `version`, `minAppVersion`, `description`, `isDesktopOnly` (+ optional `author`, `authorUrl`, `fundingUrl`, `helpUrl` only) | per template below |
| `id`: lowercase, `[a-z0-9-_]+`, no "obsidian", does not end in "plugin" | ✅ `tablify` |
| `name`: no "Obsidian", no "Plugin" | ✅ `Tablify` |
| `description`: no "Obsidian"; ≤ 250 chars; ends with `.`, `?`, `!` or `)` | per template below |
| `LICENSE` at repo root with the correct copyright holder | MIT, both copyrights |
| `README` with purpose, usage, and **network-use disclosure** | per template below |
| Release tag **exactly equals** `manifest.version`, no `v` prefix | enforced in `release.yml` |
| Release attaches `main.js`, `manifest.json`, `styles.css` as **separate** assets | ✅ |
| `versions.json` maps each version to its `minAppVersion` | ✅ |
| No telemetry, no remote code execution, no self-updating code, no obfuscation | ✅ by policy |
| No sample/boilerplate code left behind | M0 checklist |
| Command ids do not contain the plugin id redundantly | `verb-noun` convention |

## `manifest.json`

```json
{
  "id": "tablify",
  "name": "Tablify",
  "version": "0.1.0",
  "minAppVersion": "1.13.0",
  "description": "Spreadsheet-class grid view for Bases: range selection, block paste, bulk edit, and spreadsheet import with optional Airtable sync.",
  "author": "258044aamm-Dev",
  "authorUrl": "https://github.com/258044aamm-Dev",
  "isDesktopOnly": false
}
```

Notes:
- `minAppVersion` is set to **1.13.0** — the Obsidian version you actually run. Raise or lower it only after testing on that version; the Bases API floor is 1.10.2 (`BasesView.createFileForView`).
- **Never change `id` after the first release.** Changing it orphans every installed copy.
- No extra keys beyond the allowlist.

## `versions.json`

```json
{ "0.1.0": "1.13.0" }
```

One entry per release, forever. A missing entry breaks updates from older versions.

## README requirements

Must contain: what it is, how to install, how to use, screenshots, a **limitations** section (screen-reader editing, `.tabula` being read-only legacy, what sync does not do), and the network disclosure below, verbatim in substance.

### Network-use disclosure (copy into the README)

> **Network use.** Tablify is local-first and works fully offline. It makes network requests **only** when you link a view to Airtable and explicitly run a pull or push. Requests go to `api.airtable.com` using your own personal access token, which is stored in Obsidian's secret storage on your device and is never written into your vault or into any synced file. Tablify has no telemetry, no analytics and no other endpoints.

## License and attribution

- `LICENSE`: MIT, retaining the upstream copyright notice **and** adding yours.
- `NOTICE`:

```
Tablify
Copyright (c) 2026 <you>

This project began as a fork of airtable-tabula by MehulG
(https://github.com/MehulG/airtable-tabula, MIT). The .tabula file-format
compatibility and the CSV/Excel import path originate there.
```

- Do not describe the plugin as "the Airtable plugin" or as affiliated with Airtable. Airtable is named only to describe the integration, as a factual reference to their API, never as branding, in a title, or implying endorsement.

## Branding constraints (repeat of `docs/04`, because this is where they bite)

No third-party company names — Anthropic, Claude, Airtable, Notion — in the plugin name, `description`, README headings, settings copy, screenshots or repo metadata. No third-party logos or mark reproduction. No implied affiliation. The warm palette is shipped as our own tokens under our own names.

## Pre-submission checklist

- [ ] `bun run check` green on a clean checkout (`--frozen-lockfile`)
- [ ] `manifest.json` / `package.json` / `versions.json` versions agree; tag matches exactly
- [ ] Release assets are three separate files
- [ ] Description ends with punctuation, ≤ 250 chars, no "Obsidian"
- [ ] LICENSE + NOTICE committed; both copyrights present
- [ ] README with network disclosure, limitations, screenshots
- [ ] Bundle within budget; sync chunk lazily imported
- [ ] No `console.log` left in shipped paths (only the prefixed logger)
- [ ] Works in a fresh vault: install → enable → create base → edit → import → migrate a legacy file
- [ ] Verified on desktop **and** a physical phone (keyboard, long-press, safe areas)
- [ ] `.tabula` migration tested on a real legacy file, including rollback
- [ ] `CHANGELOG.md` has a real entry for the version being tagged

## Release process

1. `bun run version` (bumps `package.json`, `manifest.json`, `versions.json` in one commit).
2. Update `CHANGELOG.md`.
3. Commit, `bun run check`, push to `main`.
4. Tag the exact version string: `git tag 0.1.0 && git push --tags` (no `v`).
5. `release.yml` builds, runs the size gate, attests provenance, and publishes the three assets with changelog-derived notes.
6. Verify in-app: install from the release in a clean vault on desktop and phone.

## Post-release

- **Patch cadence:** bug fixes ship as `0.1.x`; a new release is not a milestone.
- **Compatibility promises:** the `.base` option schema and the field-type set are the public API. Breaking either requires a minor bump and a migration note in the changelog while pre-1.0, and a deprecation window after.
- **The `.tabula` format is frozen forever.** Read + migrate only. There is no scenario in which new features are added to it.
- **Issue hygiene:** issue templates for bug (with plugin/Obsidian version, platform, vault size, reproduction), feature request, and sync problem (with the sync state file redacted).
- **Support boundaries** stated in the README: no data recovery guarantees, no Airtable account troubleshooting, no support for forks of Bases.
