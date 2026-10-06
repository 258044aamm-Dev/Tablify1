Task: publish. Version, changelog, README with the network disclosure, the manual verification, three
release assets, the tag, and the community-directory submission with its prerequisites. Nothing here is
allowed to change product behaviour.

Read first: `docs/09-publishing.md` (the whole file — it is the checklist: manifest rules, the three
assets, the tag rule, the submission flow, the network disclosure wording, the reviewer-visible
requirements), `docs/06-roadmap.md` §M6 (the exit criteria, including the version for the first community
release — if it disagrees with `docs/09`, stop and report the conflict), `docs/10-verification-and-ai-hygiene.md`
§the release checklist, `docs/manual-test-log.md` (your verification evidence).

Deliverable:

1. `README.md` — the real one, containing, in this order: one sentence on what it is; a screenshot; install
   instructions (community directory first, manual BRAT/second for a pre-release, each in the documented
   form); what it does (the feature list from `docs/01`, in user language, no marketing adjectives);
   the **Network use** section with the disclosure wording from `docs/09` (plain: no network unless you
   link a base, what is sent, what is stored where, and that no telemetry exists); limitations (what it
   does not do: no formulas, no CSV export because Obsidian has one, `.tabula` is one-way, and whatever else
   the docs list); the keyboard table; the licence and attribution lines pointing at `LICENSE` and `NOTICE`.
   Every screenshot in `docs/images/` gets used or deleted; no orphan files.
2. `CHANGELOG.md` — the released version's entry written for users: what works, what is new, what changed
   since internal builds, and the known limitations in one line each. No "various fixes".
3. Version bump and tag: run `bun run version-bump` for the version `docs/06` §M6 names, then commit, then
   tag exactly that version with no `v` prefix.
4. Release assets: cut the release on GitHub and upload exactly `main.js`, `manifest.json`, `styles.css`
   (the workflow from step 04 does this — verify it did, and paste the asset list with sizes).
5. `docs/manual-test-log.md` — a final section for this release: installed from the directory into a clean
   vault on desktop and on a phone, the base opened, a cell edited, an import, an export, a `.tabula`
   migration, and (if a link is available) a pull. Each row PASS/FAIL with the version you were running.
6. The submission: the repository URL, the latest release, the plugin id, the description, and the
   developer-policies acceptance. Prepare the exact text you will paste into the submission form (id, name,
   description, repository, and the one-paragraph answer to "what does it do"), and list any prerequisite
   the doc requires that is not yet done.
7. `PROGRESS.md` updated: the release, the tag, the asset sizes, the submission state, and the
   post-release watch items (the first reviewer feedback, the first user bug, the mobile reports).

Constraints and fence:
- Touch `README.md`, `CHANGELOG.md`, `manifest.json` + `versions.json` + `package.json` (version only),
  `docs/manual-test-log.md`, `docs/images/**`, `PROGRESS.md`. No `src/**` changes in this step — if you
  believe one is needed, stop and report it as a bug for a separate step.
- No claim in the README that a test does not support. Every feature line must map to something in
  `docs/01-spec.md` and to a passing check or a manual log row.
- No brand strings: run `bun run brand:gate` before and after the README edit and paste both results.
- No token, no secret, no personal access token anywhere in the repository, the workflow, or the release
  notes. Publishing uses the workflow's `GITHUB_TOKEN`.

STOP and report instead of proceeding if: the version named by the docs is not the version in the release
you are about to cut; or a required prerequisite (LICENSE, NOTICE, README section, disclosure) is missing;
or the manual release verification has a FAIL in it.

Acceptance (paste):
- `bun run check` — green; `bun run test:layout` — green; `bun run brand:gate` — green before and after.
- The release page's asset list with sizes and checksums.
- The `git tag` output and the version in the installed plugin as reported by Obsidian.
- The README's Network use section, verbatim.
- The manual verification table for this release.
- The submission form text, ready to paste.

REPORT BACK with: the release URL; the asset list; the verification table; the submission text; the
prerequisites you could not complete; the post-release watch items; and the one thing in this release you
are least confident about, stated plainly.
