# ADR-0005 — External file edit while a document is open: never a silent overwrite

- **Status:** Accepted
- **Source:** adopted recommendation (`docs/08-decisions.md` §Open decisions,
  `docs/R2-json-repository-and-file-view.md` §conflict handling, R1 step 9 fixture
  `external-edit-vs-dirty`).
- **Phases:** R2 (the session and its dialogs), R1 (making the revision computable)
- **Proves:** R1: revision tests next to the codec; R2: session tests against the store double, then
  the real-device probe kit.

## Context

A `.tablify` file can change underneath an open document: another window, a sync client, the user's
own editor, a script. Two symmetries have to be protected — the in-memory edits are not silently
replaced by disk, and the newer disk contents are not silently replaced by a save computed from a
stale read. `docs/10` §7 fences "lossy write" behaviour; this record fixes the mechanism.

## Decision

1. **Every load records a revision** — a hash of the raw text read from disk, plus byte length. The
   revision is computed by the loader (R1 exposes it), not by the editor.
2. **Every save states the revision it was computed from.** Before writing, the writer re-reads the
   file and compares. Equal → write. Different → **refuse the write** and return
   `conflict: { expected, found }`. The refusal is a value, not an exception.
3. **On refusal the user chooses, explicitly:** (a) reload from disk (discards in-memory edits —
   only with this confirmation), or (b) keep the in-memory document as a copy/compare (no write
   until resolved; R2 decides the exact surface). There is no automatic merge in v1: merging is an
   inference this project does not make.
4. **The revision rides through every write path.** The R2 write queue serializes writes per path
   and carries the revision with the queued job, so a queued save cannot bypass the check.

## Rejected alternatives

- **Last-write-wins with a toast.** Silent data loss with a notification the user reads after the
  fact; the exact behaviour the refactor exists to remove.
- **File locking.** Obsidian vaults are synced by external tools the plugin cannot lock out; a lock
  that sync tools ignore is a false guarantee.
- **Auto-merge.** JSON merge without identity rules is guesswork; guessing wrong is unrecoverable.
- **Watch-and-reload silently.** Replaces in-memory edits without asking — the mirror image of the
  unsafe save.

## Consequences

- R1's serializer must be deterministic, or the revision proves nothing; idempotence is already
  required by ADR-0004, and the hash is over raw text, not over the model.
- R2's probe kit must include the external-edit case on desktop and phone; until then the
  behaviour above is `ASSUMED`-at-most for the plugin layer and `VERIFIED` only for the core
  revision primitive.
