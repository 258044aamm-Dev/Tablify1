# Tablify

Tablify is a spreadsheet-class grid view for Obsidian Bases: rows are your notes, columns are their
properties, and the grid behaves the way a spreadsheet does. It adds range selection, a block clipboard,
fill down, bulk edits, multi-step undo, and CSV/XLSX import and export on top of the view Bases already
gives you. Everything stays in your vault as plain notes and properties — Tablify never invents its own
storage format.

## Status

**Pre-release, internal build.** Version 0.1.0 is project skeleton only: the toolchain, the licence and
this README. No user-facing features exist yet, and nothing here is installed by anyone but the author.

## Build

```bash
bun install          # Bun 1.4.2 or newer
bun run check        # typecheck, lint, format, tests, build, size gate
bun run build        # produces main.js
```

`bun run check` also runs the brand gate and the manifest checks, so a green tree is a shippable tree.

## Network use

**The plugin makes no network requests unless you link a remote base, and that feature ships in a later
version.** Until then Tablify is entirely offline: it reads and writes notes in your vault and nothing
else. The optional one-way sync is the only feature that will ever open a connection, it is off unless
you configure it, and it sends only the changes you explicitly push. There is no telemetry, no analytics,
and no update check.

## Documentation

The design specification lives in [`docs/`](docs/): the [spec](docs/01-spec.md),
[architecture](docs/02-architecture.md), [data model and migration](docs/03-data-model-and-migration.md),
[design system](docs/04-design-system-and-layout.md),
[toolchain and CI](docs/05-toolchain-and-ci.md), [roadmap](docs/06-roadmap.md),
[test plan](docs/07-test-plan.md), [decisions](docs/08-decisions.md),
[publishing](docs/09-publishing.md) and [verification](docs/10-verification-and-ai-hygiene.md).

Contributors and coding agents start at [`AGENTS.md`](AGENTS.md); the step-by-step build prompts are in
[`prompts/`](prompts/README.md), and the current state of the work is in [`PROGRESS.md`](PROGRESS.md).

## Licence

MIT — see [`LICENSE`](LICENSE). Attribution and non-affiliation statements are in [`NOTICE`](NOTICE).
