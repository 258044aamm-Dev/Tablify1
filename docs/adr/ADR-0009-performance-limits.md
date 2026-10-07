# ADR-0009 — No hard document-size or write thresholds until measured

- **Status:** Open — deferred to measurement (R2/R5)
- **Source:** adopted recommendation (`docs/08-decisions.md` §Open decisions, `docs/R0` Step 5).
- **Phases:** R2, R5 (measurement); R1 builds the fixtures it runs on

## Context

A threshold like "refuse documents above N MB" or "warn above M rows" is only honest if N and M were
measured against the real code path on realistic data. Guessing them now would produce a number that
either never fires or fires on documents that work fine. What R1 can do is make the code path
measurable: linear parsing, no accidental quadratic work, and a large-document fixture in the
suite.

## Decision

1. **No refusal threshold exists in R1 or R2.** The parser has no size cap; the write path has no
   size cap.
2. **R2/R5 measure** `parse`, `serialize` and a save round-trip on target-sized fixtures (the R1
   step-9 large fixture is the starting shape; R5 adds a spreadsheet-realistic one — the exact
   numbers appear as test names or a recorded report, never as an unlabelled console print, because
   this repository prints nothing).
3. **If a limit is later introduced**, it must be a *warning with a recovery path* (e.g. "open
   read-only; export to a smaller file") and its number must cite the measurement that set it. A
   refusal without a path forward is a data-hostage, and this project does not ship those.

## Rejected alternatives

- **Cap now, tune later.** A cap chosen without evidence changes behaviour before anyone can say
  whether the behaviour it prevents is real.
- **No measurement ever.** "Fast enough" claimed without numbers is exactly the kind of claim
  docs/10 forbids.
- **Threshold as a silent truncation or pagination of the file.** Truncation is data loss wearing a
  performance costume.

## Consequences

- R1's step-9 fixture matrix includes `large.tablify`; R2's gate run records its numbers when the
  repository is ready for them.
- Until then, docs and tests say "no limit set", never "supports N".
