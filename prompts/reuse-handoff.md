Write a handoff note in Markdown, addressed to a fresh session with no memory of this conversation. Be
concrete enough that it can continue without reading our history, and short enough to read in two minutes.

Sections, in this order:

1. **State** — milestone, branch, the step just finished, and whether its gate was green (paste the last
   line of the gate output).
2. **Verified** — the commands run and their observed results, as facts, not as adjectives.
3. **Not verified** — everything you claimed or assumed that has no evidence, each with the cheapest way to
   check it, and the ones that are risky flagged.
4. **Half-finished** — files that are mid-change, tests that are red or skipped, anything that would break
   if someone committed now. Name the file and the line.
5. **Decisions made this session** — each with: what was decided, what the alternative was, and whether it
   belongs in `docs/08-decisions.md` (and if so, write the decision entry text you would add).
6. **Open questions for the human** — numbered, each with a default proposal so work can continue if no
   answer comes.
7. **The next step** — the exact prompt file to paste next, plus anything the next session must check first
   (a measurement, a manual test, a piece of context that exists only in your head right now).
8. **Traps** — the three things about this codebase that are easiest to get wrong, one line each.

Write it to `PROGRESS.md` (replacing the previous content, keeping its structure) and paste it in your
reply. Do not run any other commands in this turn.
