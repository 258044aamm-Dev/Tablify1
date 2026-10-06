# 09 — Publishing and release policy

> **Status:** release policy for the current plugin and planned native refactor. Current product metadata must describe the code in the corresponding release; the planned `.tablify` product is not available in `0.1.0`.

## Current release truth

- Plugin id: `tablify`; current version: `0.1.0`; manifest minimum Obsidian version: `1.13.0`; desktop/mobile flag: mobile supported.
- Tag `0.1.0` and a GitHub **prerelease** exist. It was published for personal/device testing, not listed in the community directory.
- The real Obsidian desktop/phone manual checks remain `NOT RUN` in `docs/manual-test-log.md`.
- Do not rewrite the existing tag/release or change the current manifest/package description before the new behavior is implemented.

## Release invariants

For every future release:

| Requirement | Gate |
|---|---|
| `manifest.json` includes valid `id`, `name`, `version`, `minAppVersion`, `description`, `isDesktopOnly` | `bun run manifest:check` |
| Plugin id remains `tablify` | Preserve installed identity; never create a second plugin id for this refactor. |
| Version/tag agree exactly, no `v` prefix | Release workflow guard. Use a distinct tag after `0.1.0`. |
| `versions.json` maps each released version to the minimum app version | Version-bump/release gate. |
| Release includes `main.js`, `manifest.json`, `styles.css` separately | Release workflow. |
| Changelog and README describe behavior actually shipped | Human review; no future features advertised as current. |
| No telemetry or unapproved network endpoints | Policy/code review and tests. |
| Clean build, bundle, CSS/contrast, layout gates | `bun run check`, `bun run test:layout`, release checks. |
| Real-vault/device verification is recorded | `docs/manual-test-log.md`; unrun remains `NOT RUN`. |

Keep the existing project’s release automation as source of truth; this document does not replace it.

## Product copy transition

Until the `.tablify` custom file view and repository ship, README and release metadata must continue describing the `0.1.0` Bases-backed grid. They may include a clearly separated roadmap note linking to the plan, but must not claim `.tablify` creation, multi-table files, linked-record fields, or no-Bases operation are already available.

After cutover, public product copy must state clearly:

- `.tablify` is the only native local database format and one file can contain multiple tables;
- `.base`/Markdown-note Bases data and `.tabula` are not opened, migrated, or modified by the refactored plugin;
- linked records are supported; formulas/lookups/rollups are not in the first stable release;
- attachment cells store vault-relative path references and do not embed file bytes;
- CSV/TSV/XLSX import/export and Airtable manual pull/push/conflict review are supported;
- Airtable sync is optional and explicit; token storage, network endpoints, and no-telemetry policy are disclosed.

Do not silently call the new data format “compatible” with the old release. A user may keep old files in the vault, but the new product does not promise to open them.

## Network disclosure for the native release

Adapt this only when the shipping behavior is verified:

> **Network use.** Tablify works locally and offline. It contacts Airtable only when you configure and explicitly run a pull or push. The personal access token is stored in Obsidian secret storage and is not written to the `.tablify` database, sync metadata, plugin settings file, logs, or export. Tablify has no telemetry or analytics.

The real release text must name only the endpoints the implemented client actually contacts.

## Licensing and attribution

Keep `LICENSE` and `NOTICE` intact unless a separate legal review authorizes changes. Historical attribution to the project’s source/fork lineage remains truthful; removing `.tabula` behavior does not erase provenance. Do not imply affiliation or endorsement by Obsidian or Airtable.

## Refactor release sequence

1. Complete R0–R5 and R6 source cleanup; version/tag changes are out of scope until behavior ships.
2. Update README, manifest/package descriptions, docs, screenshots, changelog, and `versions.json` together with the actual native implementation.
3. Run `bun run check`, `bun run test:layout`, bundle/release gates, and a clean checkout test.
4. Complete desktop and physical-phone verification in the manual log. Test the custom file view with Bases disabled, multi-table data, links, import/export, and optional Airtable conflict review.
5. Publish a new distinct prerelease if any manual/review gates remain; do not promote it to a stable/community listing while verification is incomplete.
6. Preserve `0.1.0` unchanged as the rollback/history point.

## Stable-release rejection conditions

Do not submit or call the release stable if: any `.base`/`.tabula` compatibility claim is ambiguous; malformed JSON can be overwritten silently; linked-record delete behavior is unresolved; token handling cannot be proven; CSV/export behavior is inaccurate; actual device checks are unrun; or public copy describes features not in the bundle.
