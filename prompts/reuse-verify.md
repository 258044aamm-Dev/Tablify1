Verify the work you just reported, before I trust it. Do not change any code in this turn.

For the step I named (or, if I did not name one, the step in `PROGRESS.md`), check and report:

1. **The gate.** Paste the raw output of the step's gate command again, run just now, from a clean tree
   (`git stash -u` first if the tree has uncommitted work; then `git stash pop`). If it differs from what
   you reported before, say so.
2. **Claims vs evidence.** Take every claim in your last report paragraph by paragraph and mark each one
   VERIFIED (with the exact command and observed output) or ASSUMED (with how I can verify it). Anything
   you cannot mark VERIFIED gets moved to an explicit list of "things you should check by hand".
3. **The diff.** `git diff --stat` for the step's commit against its parent, and one sentence per file
   explaining why that file is inside the step's fence. Flag anything outside it.
4. **The tests.** For each test added or changed in this step: does it assert behaviour, or does it assert an
   implementation detail? Name any test that would still pass if the feature were removed, and any assertion
   whose tolerance was widened.
5. **The shortcuts.** List every occurrence in the step's diff of: `any`, `as `, `!` (non-null), bare
   `catch`, `eslint-disable`, `test.skip`, `TODO`, and any magic constant with no comment. For each, say
   whether it is justified.
6. **Docs vs code.** Name any place where the code now contradicts `docs/**` or `AGENTS.md`, quoting both
   sides. Do not fix it — just report it.
7. **The honest paragraph.** In three sentences: what you are confident about, what you are not, and what
   the next person to touch this file must know.

End with a verdict line: `READY FOR THE NEXT STEP` or `NOT READY — <the one thing to fix first>`.
