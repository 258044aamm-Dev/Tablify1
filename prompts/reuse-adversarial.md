You are reviewing code you did not write. It claims to implement <the feature or step> according to
`docs/**` and the step prompt in `prompts/`. Your job is to find where it fails in production, not to
praise it.

Find the three most likely failure modes, ranked by probability × impact. For each:

- the exact file and line,
- the scenario that triggers it, written as a user action ("paste a 400-row block, then undo twice"),
- the observable wrong behaviour, precisely (a number, a message, a missing note — not "could be
  problematic"),
- the cheapest experiment that would demonstrate it: a test I can run, or three steps in a vault,
- whether an existing test already covers it (and if so, why it did not catch it).

Then check these specifically, one line each, and say PASS/FAIL/UNTESTED with the evidence:

1. error paths — every failure mode returns a typed error and leaves state consistent,
2. partial failures — a batch that fails halfway reports exactly what landed,
3. concurrent edits — two panes on the same base, and an external edit during a write,
4. empty and huge inputs — zero rows, one row, 5,000 rows, a 40-column table, a 500-character cell,
5. the mobile layout contract — the 389 px host, safe areas, the touch targets,
6. the vault contract — unknown frontmatter keys, comments, key deletion, read-only properties,
7. the data-loss contract — undo after a multi-note write, a cancelled import, a failed sync push,
8. the privacy contract — no secret in `data.json`, no network without a link, no telemetry.

Do not summarise the code. Do not list strengths. If you genuinely cannot find three real problems, say so
explicitly — but only after the eight checks above, and name the two you are least sure about.

End with: what should I verify by hand that no test in this repository can check?
