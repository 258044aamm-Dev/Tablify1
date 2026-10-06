Bug/claim: <observable behavior, file, environment, and exact steps>.

Mode: check the current user instruction. In `/Plan only mode`, do not change source code. If the request needs an implementation fix, explain the minimal fix and acceptance test, then stop for explicit authorization.

For an authorized code fix, first reproduce with the smallest failing test or harness assertion. Identify the root cause from the checked-out code, preserve existing assertions, and change only the approved file fence. Verify with `bun run check` and `bun run test:layout` when relevant; paste observed results rather than summarizing. Record real-device/vault checks as `NOT RUN` if not performed.

Do not “fix” a mismatch by relaxing a test, adding a Bases fallback, restoring `.tabula`, creating a `.base` migration, or assuming user data needs migration. Ask before a behavior change outside confirmed scope.
