# ADR-0010 — App-version floor stays until FileView APIs are verified on the oldest supported desktop and phone

- **Status:** Open — deferred to the R2 real-device probes (user-run)
- **Source:** adopted recommendation (`docs/08-decisions.md` §Open decisions, docs/R2 §FileView).
- **Phases:** R2, R6

## Context

The native `.tablify` view is planned as a custom FileView, and the manifest's `minAppVersion`
(1.13.0, as shipped in 0.1.0) may or may not actually offer every API the view needs — on desktop
and on mobile, where Obsidian's bundled API surface historically differs. Raising the floor locks
out users; lowering it on paper ships a plugin that crashes for them. The evidence is only
obtainable in a real Obsidian, which is why this record stays open until the R2 probe kit runs.

## Decision

1. **The floor does not move during R1–R5.** No manifest change as part of this refactor.
2. **The R2 probe kit** (run by the user, desktop and phone, against a checked-out commit) records:
   which FileView APIs exist at the floor version, whether registration succeeds, and whether a
   `.tablify` file opens as a view rather than as text. The kit's output is pasted into
   `docs/manual-test-log.md`; until then every plugin-layer behaviour claim is `NOT RUN`.
3. **R6 decides the floor** with that evidence — raise it if the floor lacks a required API, keep it
   if verified. The decision will cite the probe rows, not the declarations alone (`obsidian.d.ts`
   says `@since`; the app says whether it works).
4. **Desktop evidence never speaks for mobile.** Two probe rows or none; `docs/10` §7 is explicit
   that the oldest supported phone is part of the supported set.

## Rejected alternatives

- **Raise the floor now, cheap insurance.** Cuts off the users the current release supports, on a
  guess.
- **Trust `obsidian.d.ts` alone.** Typed declarations describe the package, not the app build the
  user runs; `@since` has been wrong before and differs on mobile.
- **Ship the view behind a try/catch fallback silently.** A view that degrades without evidence or
  disclosure is the "unproven FileView claim" the fences forbid; if the fallback turns out to be the
  real path, the plugin should say so.

## Consequences

- The R2 probe kit is written to answer exactly this question and to leave the answer in the log.
- Until results exist, docs describing the view carry the `NOT RUN` label rather than a support
  matrix.
