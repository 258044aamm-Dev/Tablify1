# 11 — Prompting guide

How to get *exact*, verifiable results from a coding agent on this project. Written for someone about to hand `docs/01`–`docs/10` to an agent and expect real code back.

---

## 0. The reframe (read this first)

**"Exact result" is not a wording problem.** People rewrite prompts for hours because they think the model needs a better description. Almost always the actual problem is one of five things — in this order of importance:

| Lever | The question it answers | If missing |
|---|---|---|
| **1 · Context** | Does the agent have the files, types and decisions it needs? | It invents APIs, re-decides settled questions, contradicts the spec |
| **2 · Constraints** | Does it know what it must *not* do? | It "helpfully" refactors 400 lines you didn't ask about |
| **3 · Acceptance criteria** | How does it know it's finished? | It stops when the output *looks* plausible |
| **4 · Verification** | What must it run to prove it? | You get prose instead of evidence |
| **5 · Wording** | Is the phrasing clear? | Ambiguity, wasted tokens |

Wording is fifth. A mediocre sentence with the right four levers beats a beautifully written prompt without them, every time.

The corollary, and the honest part: **you cannot get exact output in one prompt.** You get it from a short loop — plan, approve, implement, verify — where each step is small enough that a wrong answer is cheap to spot. An agent that promises the whole plugin from one paragraph will produce 4,000 lines you cannot verify, which is worse than nothing because it *looks* like progress.

### The failure this project already lived through

Your fork's history is the textbook case. Somebody prompted, in effect, *"the grid doesn't fill the page on mobile, fix it."* What followed: **~15 commits** chasing a layout bug, including two temporary diagnostic-overlay builds, none of it backed by an acceptance criterion or a committed test. Every fix "worked" locally and the bug returned, because the prompt never said **how to prove it was fixed**.

Compare that with the prompt in §10. Same bug, one afternoon.

---

## 1. Anatomy of a high-signal prompt

Eight slots. Missing slots are where agents improvise.

```
1 · ROLE + PROJECT      What this codebase is, in one line, and which docs govern it.
2 · TASK                One goal, stated as an outcome, not a technique.
3 · CONTEXT TO READ     Exact files (paths). Not descriptions of files.
4 · CONSTRAINTS         What must not change. Explicit boundaries. The stop-and-ask list.
5 · DELIVERABLE         Concrete artifacts: files created/modified, and nothing else.
6 · ACCEPTANCE          Observable criteria — commands that pass, behaviour that works.
7 · VERIFICATION        What to run and paste back (raw output, not summaries).
8 · OUTPUT FORMAT       Plan first? Diff summary? Questions before starting?
```

### The base template

```
Project: <one line>. Governing docs: AGENTS.md, docs/02-architecture.md,
docs/08-decisions.md (decisions are settled — do not re-litigate them).

Task: <single outcome>.

Read first: <exact paths>. Do not read anything else except as needed to follow imports.

Constraints:
- Follow docs/02 architecture boundaries; do not add anything to core/ that imports Obsidian or React.
- Do not modify files outside: <paths>.
- Do not add dependencies. If one seems necessary, stop and ask.
- Stop and ask before: <risky-action list>.

Deliverable: <files>, and nothing else.

Acceptance: <observable criteria>.

Verification: run `bun run check` and paste the raw output. If it fails, fix and re-run;
do not report success until it passes.

Output: plan first (max 10 lines), then wait for my approval before writing code.
```

That last line is worth more than everything above it. **Plan-first is the single highest-leverage habit** for exactness: it costs one turn and catches misunderstandings before they become 600 lines of code.

---

## 2. Context engineering

The agent cannot know what you didn't give it. What it *can* do is invent something plausible, which is worse.

### What to attach, in this project

| Situation | Attach | Why |
|---|---|---|
| Any task | `AGENTS.md` | Boundaries, conventions, never-do list |
| Any architecture-touching task | `docs/02-architecture.md` | Layer rules, port definitions, budgets |
| Any data task | `docs/03-data-model-and-migration.md` | Field mapping, write rules |
| Any decision-sensitive task | `docs/08-decisions.md` | So it does not re-litigate P1–P20 / E1–E12 |
| Any UI task | `docs/04-design-system-and-layout.md` | Tokens, layout contract, a11y |
| Any verification claim | `docs/10-verification-and-ai-hygiene.md` | Cite-or-die rules |
| The actual code | The 2–4 files in scope, **not** the whole repo | Context is a budget; noise degrades accuracy |

### Rules

1. **Point, don't paste.** "Read `src/core/fieldTypes/registry.ts`" beats pasting 300 lines into the prompt — the agent reads the real file with real line numbers.
2. **Never describe an API from memory.** Say *which file defines it*. In this project, that's `node_modules/obsidian/obsidian.d.ts`, and the agent should grep it (see §5, cite-or-die).
3. **Give the source of truth, not a summary.** If you hand a summary of `docs/03`, the agent will follow your summary even where it is wrong. Hand the file.
4. **Establish the invariant once, in the repo.** A rule written into `AGENTS.md` applies to every future session for free. A rule typed into a chat applies once. This is why `AGENTS.md` exists.
5. **One screen of context per goal.** If the prompt is longer than the deliverable, the scope is too big.

### Context that must travel between sessions

Long sessions get compacted, and the agent forgets decisions it made an hour ago. Re-anchor with this, pasted at the start of every new session:

```
Re-anchor: we are on milestone M<n> of the Tablify rewrite.
Settled: AGENTS.md + all rows in docs/08-decisions.md (do not re-open them).
Current state: <branch, last completed step, anything half-finished>.
Next goal: <the one thing>.
Re-read: AGENTS.md, the milestone section of docs/06-roadmap.md, <files in scope>.
```

---

## 3. Scope discipline

**The unit of work is one milestone section, one branch, one PR.** Not "the plugin", not "the data layer", not even "M2" — one *step* inside it.

- **The 600-line rule.** A human reviewer's effective limit is roughly 600 changed lines. Past that, review becomes scrolling, and un-reviewed code is un-verified code. If a step needs more, split the step.
- **One goal per turn.** "Add the write queue and also fix the CSS" produces two half-done things and one muddy diff.
- **Explicitly fence the files.** `Do not modify files outside: src/adapters/**, tests/fakes/**`. Then check: `git diff --stat` should match the fence. If it doesn't, that's not a stylistic nit — it means the agent decided things you didn't ask it to.
- **Forbidden-zone list for this project** (paste it into prompts):
  `manifest.json` (except a version bump), `styles.css` outside `src/grid/styles/`, any file under `docs/` unless asked, `.github/workflows/` unless asked, anything in `src/core/` for a UI task.

---

## 4. The loop

```
① KICKOFF      →  one-time: project + rules + current milestone context
② PLAN         →  agent proposes approach, files, acceptance. You approve or correct. NO CODE.
③ SPIKE        →  if the approach rests on an unverified API assumption: prove it in ≤50 lines
④ IMPLEMENT    →  one step, fenced files, tests in the same commit
⑤ VERIFY       →  agent pastes raw output; you re-run it yourself
⑥ ADVERSARIAL  →  a second pass (different model = better): "how is this wrong?"
⑦ COMMIT       →  you read the diff. Milestone boundary = human device test.
```

Where prompts go wrong at each step:

| Step | Failure | Fix |
|---|---|---|
| ② | Agent starts coding immediately after the plan prompt | Add: "**Do not write code yet.**" Explicit beats implied |
| ② | A vague plan ("I'll refactor the store") | Demand: file list, function signatures, acceptance commands |
| ③ | Agent "confirms" an API from memory | Demand: cite-or-die (§5) — file + symbol from `obsidian.d.ts` |
| ④ | Diff touches 30 files | Fence in the prompt; reject and re-issue |
| ⑤ | "All checks passed ✅" with no output | Demand raw output. No output, no merge |
| ⑥ | Review finds nothing (a rubber stamp) | Ask for **falsification**: "name the cheapest experiment that fails if this is wrong" |
| ⑦ | You skim the diff because the summary sounded good | Read `git diff --stat` first, then the diff. Summaries lie by omission, not by lying |

---

## 5. Verification clauses to include in every implementation prompt

Paste this block verbatim into prompts that produce code. It is short, and it is the difference between "the agent says it works" and "you know it works".

```
Verification requirements:
- Run `bun run check` (typecheck + lint + test + build + size) and paste the RAW output.
  Do not paraphrase it. Do not report success if it fails; fix it or stop and report.
- Any Obsidian API you use must be cited as `SymbolName` — from node_modules/obsidian/obsidian.d.ts
  (file + symbol, e.g. "BasesView.createFileForView, @since 1.10.2"). Uncited API usage is a failure.
- No `any`, no `!`, no bare `catch {}`. If you believe one is necessary, stop and ask.
- No new dependency. If one is required, stop and ask with: name, size (min+gzip), why not hand-rolled.
- No files outside the fence. Show `git diff --stat` when done.
- Tests: for core/ or adapters/, new behaviour ships with unit tests in the same change.
  For UI fixes, a harness assertion that fails before the fix and passes after.
- When you stop, state: what you did, what you verified, what you did NOT verify, what you assumed.
```

The last line is the most valuable sentence in this document. **"What did you NOT verify, and what did you assume?"** — asked every single turn — surfaces exactly the kind of error that a confident summary hides.

---

## 6. Prompt patterns worth knowing

| Pattern | Use when | Prompt skeleton |
|---|---|---|
| **Plan-first** | Always, for anything non-trivial | "Plan first, max 10 lines, no code. Wait for approval." |
| **Spike** | An approach rests on an API/behaviour assumption | "Write ≤50 lines that prove or disprove <X> on my real setup. If it fails, report the failure — a failed spike is a success." |
| **Falsification** | Before accepting any conclusion | "What would prove this wrong? What is the cheapest experiment that fails if this is false?" |
| **Red-team** | After a milestone | "You are reviewing someone else's work that you did not write. Find the three most likely ways this fails in production. Do not list strengths." |
| **Rubber duck** | When the agent seems stuck in a loop | "Explain your current understanding of the problem in one paragraph, without proposing a fix." |
| **Bisect** | A regression appeared | "Find the commit that introduced <behaviour> using git bisect, and report the commit + the exact line." |
| **Test-first** | Any `core/` logic | "Write the failing test first, show it failing, then implement." |
| **Constraint stress** | Boundaries feel shaky | "List every file you changed and why each is inside the fence. If any is outside, say so." |
| **Handoff** | Before context compaction | "Write a handoff note: state, decisions made, open questions, next step, files touched." |
| **Second opinion** | High-stakes decision | Run the same question through a different model, then **diff the answers**. Disagreement marks the risky part. |

---

## 7. Anti-patterns, with rewrites

| ❌ Weak | ✅ Precise | Why |
|---|---|---|
| "Refactor this to be clean and modern" | "Extract the 18 field-type `switch` sites in `store.ts`/`query.ts`/`cellClipboard.ts` into `core/fieldTypes/*` descriptors per `docs/02` §registry; acceptance: no `switch (field.type)` outside that directory; `bun run test` green" | "Clean" and "modern" are not observable. Name the mechanism and the proof |
| "Make the grid fast" | "Windowing only; budget: 5,000-row fixture first paint ≤ 300 ms, ≥ 55 fps scripted scroll in the harness; report the measured numbers" | A number can be checked; an adjective cannot |
| "Fix the mobile layout" | "The root must fill its host at all 5 harness viewports, including the 389 px squeezed host. Add the assertion, show it failing, then fix" *(this is the fork's 15-commit bug — with an acceptance criterion it is a one-afternoon fix)* | The old prompt had no definition of done, so "done" was whatever looked plausible |
| "Use the Bases API to read the data" | "Read `node_modules/obsidian/obsidian.d.ts`; cite the exact members you use from `BasesView` and `BasesEntry`. If a member doesn't exist, say so — do not invent one" | Removes the single most common AI failure: a plausible method that isn't real |
| "Write tests for this" | "Coverage thresholds: 85% lines/functions on `core/`. Assertions must test behaviour, not mocks or snapshots. Show the failing-first test for each new rule" | "Write tests" invites test theatre |
| "Also improve anything else you notice" | "Report observations outside scope in a list; change nothing outside the fence" | Unbounded permission is how 600-line diffs become 6,000 |
| "Here's my whole codebase, go" | "Read `AGENTS.md`, `docs/02`, and these 3 files" | Noise dilutes attention and increases invention |

---

## 8. Diagnostics: "the AI keeps doing X"

| Symptom | Actual cause | Prompt fix |
|---|---|---|
| Invents APIs | No access to the real types | Add cite-or-die + `node_modules/obsidian/obsidian.d.ts` |
| Re-opens settled decisions | Decisions live in a chat, not in a file | Point at `docs/08-decisions.md`; add "decisions are settled — do not re-litigate" |
| Huge diffs | No fence, no line limit | Fence the files; demand `git diff --stat` before review |
| Says "done" without evidence | Nothing demanded evidence | Add the verification block (§5) verbatim |
| Loops on the same fix | No acceptance criterion, so it can't tell it's fixed | Write the failing test/assertion first; make *that* the task |
| Half-finished features | Multi-goal prompt | One goal per turn; split into steps |
| Ignores the architecture | Boundaries not in context, or not enforced | Attach `docs/02`; require the ESLint boundary rule to pass |
| Forgets everything mid-session | Context compaction | Re-anchor prompt (§2); keep `AGENTS.md` + ADRs as the memory that survives |
| Regresses earlier work | No regression gate | "Run the full suite; if anything regressed, stop and report — do not 'fix' it by adjusting the test" |
| Over-explains, under-delivers | Ask for prose | Specify the output format: plan, then diff summary, then raw command output |

---

## 9. Case study: this project, prompted well

The prompt that would have saved ~15 commits. Note that it is not clever — it has a fence, an acceptance criterion and a proof requirement:

```
Task: the grid must fill its container on mobile when the keyboard is open.

Read: docs/04 (layout contract §The layout contract, §Mobile), AGENTS.md (never-do list).

Constraint: the fix may not introduce a percentage-height chain, a ResizeObserver-driven
height variable, or `!important`. If you believe one is required, stop and explain why
before writing it.

Deliverable:
1. A harness case that reproduces the failure: viewport 390×844, host artificially squeezed
   to 389 px (this is the real measurement from the old build's own changelog).
2. The fix.
3. Nothing else.

Acceptance: the new assertion fails on the current code and passes after the fix;
`.tablify-root` measures exactly its host's padding box at all 5 harness viewports.

Verification: paste raw output of `bun run test:layout` before and after. Confirm no other
harness case regressed. State what you did not verify.

Stop and ask if: the fix requires touching grid.css beyond the height contract, or if
the failing measurement has a different cause than the host squeeze.
```

That prompt is *reproducible*: the assertion stays in the repo, so the bug cannot come back silently. That is what "exact result" actually means in practice — not a perfect first answer, but an answer that is **checkable, and then checked**.

---

## 10. The one-page summary

1. **You can't prompt your way to exactness in one shot.** Use the loop: plan → approve → implement → verify.
2. **Plan-first, always.** One turn now saves a day later.
3. **Point at files; don't describe them.** Primary sources, real paths, `obsidian.d.ts` for APIs.
4. **Fence the scope.** One goal, explicit file list, `git diff --stat` to prove it.
5. **Demand raw output, never summaries.** No output, no merge.
6. **Ask what was NOT verified and what was assumed** — every single turn.
7. **Write the acceptance criterion before the code.** A failing test is a better spec than a paragraph.
8. **Different model for review.** Ask for falsification, not validation.
9. **Put durable rules in `AGENTS.md`,** not in chat turns. Repo memory beats session memory.
10. **Small and verifiable beats big and impressive.** Every time.

The rest of this file set is written to be used this way: `docs/12-agent-prompt-pack.md` has the ready-to-paste prompts for every milestone.
