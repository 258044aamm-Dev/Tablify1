Task: make the repository legally and technically ready to be released, and prove it with scripts rather
than good intentions. This is M0's second half; no product code.

Read first: `docs/09-publishing.md` (manifest rules, release mechanics, the network disclosure),
`docs/08-decisions.md` §Publishing (the identity decisions), `docs/06-roadmap.md` §M0 (the exit criteria),
`docs/10-verification-and-ai-hygiene.md` §brand rules.

Deliverable — exactly these:

1. `manifest.json`
   - `"id": "tablify"` (lowercase, no "obsidian" in it, no `+`), `"name": "Tablify"`,
     `"version": "0.1.0"`, `"minAppVersion": "1.13.0"`, `"isDesktopOnly": false`,
     `"author": "258044aamm-Dev"`, `"authorUrl": "https://github.com/258044aamm-Dev"`.
   - `"description"` — one sentence, under 250 characters, describing what it does for a user; it must not
     contain the words Airtable, Anthropic, Claude, Obsidian-safe marketing, or the phrase "Airtable-like".
     Propose three options in your report and use the first in the file.
   - No `fundingUrl`, no `helpUrl` unless I ask.
   - `minAppVersion` must be justified in the report by the API facts we depend on
     (`registerBasesView` and `BasesView.createFileForView`, `@since 1.10.2`, read from
     `node_modules/obsidian/obsidian.d.ts`); if your reading of the `@since` tags implies a higher floor
     than 1.13.0, say so and stop.
2. `versions.json` — `{ "0.1.0": "1.13.0" }`.
3. `CHANGELOG.md` — Keep-a-Changelog shape, with one `## [0.1.0]` entry listing: "Initial internal build —
   project skeleton only. No user-facing features yet." Version headings must match `manifest.json` exactly.
4. `LICENSE` — MIT. Retain the upstream copyright: read the archived fork's `LICENSE` (clone
   `https://github.com/258044aamm-Dev/airtable-tabula` into `../airtable-tabula` if it is not already next
   to this repository) and reproduce its copyright line **verbatim**, then add your own line:
   `Copyright (c) 2026 258044aamm-Dev`. If the upstream repository has no LICENSE file, stop and report —
   do not invent one.
5. `NOTICE` — plain text, listing: this project is an independent work; it is inspired by and carries
   attribution to the upstream project (name the repository and its copyright line); it is not affiliated
   with, endorsed by, or sponsored by Airtable, Anthropic, or Obsidian. State that the `.tabula` file
   format is supported for one-way import only.
6. `README.md` (skeleton, honest): what Tablify is in three sentences, the status line
   ("pre-release, internal build"), how to build (`bun install`, `bun run check`), a placeholder
   "Network use" section that says plainly: *the plugin makes no network requests unless you link an
   Airtable base, and that feature ships in a later version* — and a licence line pointing at `LICENSE`
   and `NOTICE`. No screenshots yet, no feature promises beyond what exists.
7. `scripts/brand-gate.ts` — a script that fails (exit 1) if any of these strings appear in repository
   text files (excluding `prototype/**`, `docs/**`, `node_modules/**`, `.git/**`, `bun.lock`,
   `playwright-report/**`): `anthropic`, `claude`, `airtable` **except** in the allowed contexts
   (API host `api.airtable.com`, the word `Airtable` inside `NOTICE` and inside the sync module's
   user-facing strings that name the service they connect to, and `.tabula`-related attribution).
   Implement the allowlist as an explicit, commented list of file+line patterns — not as a fuzzy rule.
   The script must print every match it allows, so I can audit the allowlist.
8. `scripts/manifest-check.ts` — validates: `manifest.json` parses; `id` matches `^[a-z0-9-]+$` and has no
   `obsidian`; `version` equals the top `CHANGELOG.md` version equals the newest `versions.json` key;
   every `versions.json` value is a valid `minAppVersion`; `description` length ≤ 250 and contains no
   banned brand token; `isDesktopOnly` is a boolean. Exit non-zero with one clear line per failure.
9. Wire both scripts into `package.json` as `brand:gate` and `manifest:check`, and add them to the `check`
   script right after `lint`. (The gate must never depend on network access.)
10. Update `PROGRESS.md`: step 02 complete, what is verified, the `minAppVersion` decision and its
    evidence, the next step.

Constraints and fence:
- Do not touch `docs/**`, `AGENTS.md`, `eslint.config.mts` (except adding the two scripts to
  `package.json`'s script list), `prototype/**`, or any file from step 01 other than `package.json`
  and `PROGRESS.md`.
- The licence text must be the standard MIT text, unmodified except for the copyright lines. Do not write
  your own licence or a "based on" clause inside it — attribution belongs in `NOTICE`.
- No placeholders anywhere: no `<name>`, no `TODO: add`, no "fill in later". If a value is genuinely
  unknown, stop and ask me.

STOP and report instead of proceeding if: the upstream LICENSE is missing or is not permissive; or the
`@since` reading implies a `minAppVersion` above 1.13.0; or the description cannot be written under 250
characters without naming a banned brand.

Acceptance (paste raw output):
- `bun run check` — green, now including `brand:gate` and `manifest:check`.
- `bun run manifest:check` — green; then change `version` in `manifest.json` to `0.2.0`, show it **fails**,
  and revert.
- `bun run brand:gate` — green; then add the single line `// a Claude test` to a scratch file under `src/`,
  show it **fails**, and delete the scratch file.
- `git status --short` — show that only the files listed in this prompt changed.

REPORT BACK with: the file list; the three description options you considered; the `minAppVersion` reading
with the quoted `@since` lines; the raw output of `bun run check`, the two deliberate failures and their
fixes; the current allowlist entries in `brand-gate.ts`; anything ASSUMED; the exact next step.
