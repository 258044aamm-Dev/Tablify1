# Developer notes — the native `.tablify` plugin

> **Current tree.** This tree is the native `.tablify` plugin (R0–R6 refactor). It has no Bases view, no `.base` config reader or writer, no `.tabula` reader, and no note-backed rows. The `0.1.0` release on the repository's history was Bases-backed. That release is historical; this tree does not reproduce it.

## Scratch-vault testing

Use a disposable vault, not a user's production vault. Build commands come from `package.json`. The release procedure is in [`docs/09-publishing.md`](../../docs/09-publishing.md).

Manual checks are recorded in [`docs/manual-test-log.md`](../../docs/manual-test-log.md). Their status is `NOT RUN` until a real Obsidian host has run them. A browser harness is not a substitute for those checks.

## Rules for the native implementation

- Do not add `BasesView`, `registerBasesView`, `.base` config, `processFrontMatter`, note paths as row IDs, or `.tabula` parsing.
- Obsidian APIs stay limited to what the plugin needs: custom file views, workspace leaves, vault text files, settings, commands, notices, modals and menus, and `SecretStorage`.

## Where the design lives

- [`docs/REFACTOR-PLAN.md`](../../docs/REFACTOR-PLAN.md) and [`docs/README.md`](../../docs/README.md) hold the target behaviour and the phase guides.
- If work on the native file view is authorised, follow `AGENTS.md` and the file fence in the phase prompt. Plan-only mode does not authorise application code.
