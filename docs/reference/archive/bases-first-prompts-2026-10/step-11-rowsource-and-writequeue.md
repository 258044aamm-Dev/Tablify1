Task: implement the `RowSource` port and the write queue. This is the layer that makes editing safe:
coalescing per file+property, serialising per file, rolling back on failure, and a `flush()` that actually
means "on disk". No Bases code yet — the queue is tested against the fake vault.

Read first: `docs/02-architecture.md` §RowSource, §the write queue (the acceptance rules live there),
`docs/03-data-model-and-migration.md` §write rules (what is written for each type, what happens when a
value is cleared, the read-only properties), `docs/07-test-plan.md` §Tier 2 (the five assertions),
step 10's `spike/bases-path/FINDINGS.md` (the verified facts about `processFrontMatter`),
`docs/08-decisions.md` §P8, §E7.

Deliverable:

1. `src/adapters/RowSource.ts` — the port, exactly as `docs/02` defines it: reading
   (`schema()`, `rows()`, `subscribe(cb)`, `getValue`/typed access helpers), writing
   (`apply(ops): Promise<WriteResult>`), lifecycle (`dispose()`), and the capability flags the grid needs
   (`readonly`, `canCreateRows`, `canDeleteRows`). No Obsidian types in the interface — the port must be
   implementable by a fixture (the harness) and by the fake vault tests.
2. `src/adapters/writeQueue.ts` — the implementation of the queue:
   - **Coalescing**: two writes to the same file+property in one tick become one `processFrontMatter` call
     whose callback sets only the final value. A write to a different property of the same file joins the
     same call. A write to a different file is a separate call.
   - **Serialisation**: never two `processFrontMatter` calls in flight for the same file, and in-flight
     per-file chains never interleave. Different files may proceed in parallel, bounded by a documented
     concurrency limit.
   - **Ordering**: within a file, the caller's order is preserved exactly.
   - **Rollback**: if the callback throws, only the affected optimistic overlay entries are dropped; the
     queue reports a per-file error and keeps processing other files.
   - **`flush()`**: resolves only after the last queued call has resolved (or failed and been recorded),
     and it must be idempotent and safe to call twice.
   - **Debounce**: a short debounce before the first call for a given file (the docs name the value — use
     it, do not invent one), with the guarantee that `flush()` bypasses the debounce.
   - **Clearing a value deletes the key** (never writes `""`, never writes `undefined`, never writes
     `null` — the type registry decides, the queue just passes the frontmatter mutation through).
   - **Unknown keys survive**: the callback mutates the frontmatter object it is given; it must not replace
     the object, and the queue must not read-modify-write outside the callback.
3. `src/adapters/optimistic.ts` — the overlay: `set(filePath, propertyId, value)`, `get`, `clear`, and
   `subscribe`. Read paths in the grid consult `get` first. The overlay never holds a whole row's clone —
   only the pending values — so an external change is not masked for more than the pending properties.
4. `tests/unit/write-queue.test.ts` — every bullet above, using `tests/fakes/vault.ts` and the fake clock:
   - 12 property writes to one file in a tick ⇒ exactly one `processFrontMatter` call (assert
     `vault.writes.length === 1`),
   - interleaved writes from two sources to the same file are serialised and nothing is lost (assert the
     final frontmatter equals the sum of both writers' intentions),
   - a throwing callback drops only that property's overlay and reports `{ path, error }` while other files
     still land,
   - `flush()` resolves after the last write resolves (use the clock: advance timers, resolve promises in a
     deterministic order, assert the ordering of `writes` timestamps),
   - unknown keys and comments around frontmatter survive a full cycle (compare `vault.raw(path)` before
     and after, byte for byte except the changed key),
   - clearing writes absence: `!("key" in frontmatter)` after the write,
   - `vault.modify` is never called (the fake throws; assert the write log contains only
     `processFrontMatter`).
5. `PROGRESS.md` updated (M2 started; the queue's documented constants: debounce, concurrency, retry).

Constraints and fence:
- Touch only `src/adapters/**`, `tests/unit/**`, `PROGRESS.md`. No React, no Bases imports, no network.
- `src/adapters` may import `obsidian` types but must not construct a real `App`: the queue takes an
  injected `{ processFrontMatter }`-shaped dependency. That is what makes it testable without a vault.
- No `any`, no `as`, no `!`, no bare `catch`; errors are values in the result type, and every error carries
  `{ path, propertyId?, message, cause? }`.

STOP and report instead of proceeding if: the port interface in `docs/02` needs a method the docs do not
have (report the method and the call site that needs it); or serialisation cannot be guaranteed with the
injected dependency shape; or the docs' debounce value contradicts `flush()`'s guarantee.

Acceptance (paste raw output):
- `bun run check` — green, with the new tests and coverage thresholds met for `src/adapters/writeQueue.ts`
  and `src/adapters/optimistic.ts`.
- The write-log assertions: paste the actual array contents for the 12-writes case (one entry) and for the
  two-writer case.
- The `flush()` ordering trace.
- The byte-for-byte unknown-key preservation diff.

REPORT BACK with: the file list; the raw gate output; the queue constants you used and the doc sentence that
authorised each; the overlay's masking rule; anything ASSUMED; the exact next step (BasesSource, which is
gated on step 10's findings being confirmed).
