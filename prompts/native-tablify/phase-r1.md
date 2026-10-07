# R1 — JSON schema and pure core planning

**Guide:** `docs/R1-json-schema-and-core.md`
**Mode:** authorized for implementation (2026-10-07), on `refactor/native-tablify`, one step at a time with a push after each step. The planning task below was completed; it stays as the phase's plan of record. See `docs/08-decisions.md` §Implementation authorization log.

Read `AGENTS.md`, `docs/08-decisions.md`, `docs/03-data-model-and-migration.md`, the R1 guide, current core/field/query types, and existing tests. Treat existing code as legacy evidence, not target authority.

## Plan-only task

Produce a proposed schema/interface/test plan—do not edit files. Cover:

1. Versioned JSON top-level contract for one database containing multiple tables.
2. Stable database/table/field/row/view/option IDs and uniqueness rules.
3. JSON-safe values for every retained field type, including attachment path references and linked-record IDs.
4. Validation errors, unknown keys, malformed input, unsupported future versions, and round-trip preservation.
5. Internal `.tablify` version migration only; explicitly no `.base` or `.tabula` conversion.
6. Test fixture matrix and the exact core-only dependency boundary.
7. Open ADRs and smallest decision needed before each schema item can be frozen.

The user has now separately authorized code work, and the blocking decisions are recorded in `docs/adr/` (0001, 0003, 0004 for this phase). Implement one step at a time; never skip a step's tests or its gate run.

## Acceptance for the plan

Exact proposed files/interfaces, no dependency added, every format claim labeled confirmed/proposed/open, tests tied to user-observable behavior, and a clear no-data-loss policy.
