Bug: <paste the observable behaviour here, with the device, viewport, Obsidian version and the exact steps>.

Here is the failing output, pasted raw:

```
<paste the failing gate output, or the console error, or the stack trace>
```

Do not fix anything yet. In this order:

1. **Reproduce it in a test.** Write the smallest assertion that fails on the current code: a unit test, a
   store test, or a Tier-4 layout assertion if it is a visual/interaction bug. Paste the failing output.
   This assertion is the definition of done. If you cannot reproduce it there, say so and stop — that is a
   finding, not a failure, and guessing at a fix is how this project got its 15-commit bug history.
2. **Root cause, one sentence, with the file and line that proves it.** Not a theory: the line. If the cause
   is in a dependency or in Obsidian's behaviour, say which, and quote the evidence (the declaration, the
   console output, the diff).
3. **The fix, minimal.** Touch only what the cause requires. If the cause is structural, stop after step 2
   and describe the change you would make, then wait for my approval.
4. **The guard.** Keep the assertion from step 1 in the suite (that is the point). If the bug class could
   occur elsewhere, add the same assertion where it applies, and say where.
5. **No regressions.** Paste the raw output of the full gate and of the layout suite.

Rules: no fix may relax, skip or delete an existing assertion. No `eslint-disable`, no `any`, no cast that
hides the cause. If the fix requires a new dependency, stop and ask. If you cannot explain why the fix
works, you do not have the root cause yet — go back to step 2.
