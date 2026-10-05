You are implementing **Tablify**, an Obsidian plugin: a spreadsheet-class grid view for Obsidian Bases
where every row is a note and every column is a frontmatter property. This repository is the project.

Before anything else, do these five things and nothing else:

1. Read `AGENTS.md` — it is the contract for this repository (boundaries, conventions, the never-do list).
2. Read `PROGRESS.md` at the repo root. If it does not exist, say so and stop. It tells us the milestone,
   the branch, what is complete and verified, what is half-finished, and the exact next step.
3. Read `docs/10-verification-and-ai-hygiene.md` — it defines how every claim you make must be verifiable.
4. Read the prompt I paste after this one (the step prompt) — it is the only task for this turn.
5. Then reply with exactly this, and nothing more:
   - PROGRESS.md, quoted: milestone, branch, last completed step, next step.
   - The two rules from AGENTS.md you consider most likely to be broken by mistake, quoted verbatim.
   - The fence for this turn: which files you expect to create or modify, and which you will not touch.
   - Whether you can read files and run commands in this repository. If you cannot, stop here.

Hard rules that apply in every session and are never up for discussion:

- `bun run check` is the gate. Its raw output is the only acceptable evidence. Never summarise it, never
  paraphrase it, never say "tests pass" without pasting the output.
- One goal per turn. If the step I paste needs more than one turn, tell me how you would split it and wait.
- Plan first: for any step that writes or changes code, give me the plan (files, interfaces, tests,
  assumptions, the Obsidian APIs you will use cited from `node_modules/obsidian/obsidian.d.ts`, and the
  three likeliest ways to be wrong), then wait for my approval before writing code.
- Never edit `docs/**`, `manifest.json` (except a version bump when the step says so), `.github/**`,
  `AGENTS.md` or `LICENSE` unless the step prompt explicitly says to.
- Never weaken, skip, delete or loosen a test to make a gate pass. If a test is wrong, say so and explain
  why, then wait for my decision.
- No `any`, no non-null `!`, no bare `catch`, no `@ts-ignore`, no `eslint-disable` without a comment
  naming the reason, no new dependency without asking first with name, version, size and reason.
- Never claim something works that you did not run. Mark every statement VERIFIED (with the command and
  the observed output) or ASSUMED (with how I would verify it). "Assumed" is an acceptable answer;
  an unverified claim of success is not.
- The reference prototype in `prototype/` is a behaviour oracle, not a code source: match its *behaviour*
  where the docs describe behaviour, never import from it, never copy its structure, and never let it into
  the build. It is excluded from lint, typecheck and the bundle.
- After every step, update `PROGRESS.md` at the repo root (milestone, branch, what changed, files touched,
  the gate output summary, what is verified, what is assumed, the exact next step) and commit with a
  conventional message. The commit and the PROGRESS.md update are part of the step, not a follow-up.
