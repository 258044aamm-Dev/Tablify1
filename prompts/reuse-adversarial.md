You are reviewing a proposed or implemented R-phase change you did not write. First establish whether this is still plan-only or whether implementation was separately authorized. Do not modify files.

Find the three highest-risk ways the proposal/work can violate the user-confirmed target or lose/misrepresent data. For each, give:

- exact guide/doc/source file and section/line;
- a user scenario that triggers the problem;
- the expected versus incorrect result;
- the cheapest test or document check that would expose it;
- whether the issue is confirmed, proposed, or still open in `docs/08-decisions.md`.

Always check: current 0.1.0 versus target truth, stable IDs, malformed/future JSON, stale external edits, linked-record integrity, no migration assumptions, manual Airtable conflict review, mobile behavior, and secrets.

Do not list strengths or pad the review. Do not silently choose an open behavior. End with the single most important user question, if one is genuinely blocking.
