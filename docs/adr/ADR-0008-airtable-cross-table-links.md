# ADR-0008 — Airtable cross-table links sync only with a complete record map

- **Status:** Accepted
- **Source:** adopted recommendation (`docs/08-decisions.md` §Open decisions,
  `docs/R5-import-export-and-airtable.md` §cross-table links).
- **Phases:** R5
- **Proves:** R5 sync tests with an injected API double (no network in tests), then the real-vault
  smoke run the user performs.

## Context

Airtable linked-record columns carry record ids of another table. Pulling a table updates a local
mirror; if a link column is written while the *target* table's local record map is incomplete (the
target was not pulled, or only partially), an id that exists remotely looks exactly like an id that
was deleted. Writing "empty" for it — or dropping it — silently destroys a link the next complete
pull would have restored. The reverse (fabricating a link to a missing local row) creates a value
the document's own validator (ADR-0001) would then flag as unresolved, with no record to repair to.

## Decision

1. **Precondition:** a linked-record column syncs only when the target table has a *complete* record
   map for the same sync pass — i.e. its pull finished and produced a full id set. "Complete" is
   measured (an explicit completeness flag on the pass's result), never assumed from "a pull ran".
2. **Partial map → the column is reported `cannot-sync` for the affected rows and left untouched.**
   No half-writes: no empty arrays, no dropped ids, no local fabrication.
3. **Mapped writes are append-safe:** an id is written only when it resolves to a pulled row;
   clearing a link happens only when the source explicitly reports the link removed *and* the
   target map is complete.
4. **Still no legacy matching:** the record mapping is keyed by the Airtable record id against the
   local row's exported identity — not by path, not by view, not by the retired Bases keys
   (ADR-0006). With Airtable now keyed to `databaseId+tableId`/`rowId`/`fieldId` per R5.
5. **No network in any test.** The ADR is enforced by tests against an injected double; the real
   API check is the user-run smoke test in the R5 probe kit, and its result is the only thing that
   may move a `NOT RUN` row.

## Rejected alternatives

- **Write what the source reports even with an incomplete map.** Turns "target not pulled yet" into
  data loss, intermittently, depending on pull order.
- **Queue the link write for later.** A deferred write with no expiry violates "no unproven write
  claims" (docs/10) and grows a shadow transaction log this architecture exists to avoid.
- **Best-effort matching by name/summary.** Names change; the link is an id relationship, and a
  name match is a guess with a write behind it.

## Consequences

- The sync pass result carries a per-table completeness flag; R5's orchestrator is written so a
  failed target pull cannot yield a "complete" flag.
- R5's smoke test must exercise the partial-map path or the completeness flag is untested in
  practice; the probe kit names that case explicitly.
