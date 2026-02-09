# circuit-breaker

## What This Tests

Tests the circuit breaker mechanism: when CI failures reach the maximum retry count (5), the issue transitions to Blocked state and the bot is unassigned, preventing infinite retry loops.

## State Machine Context

The circuit breaker protects against infinite iteration loops. Key mechanics:

- **failures** field tracks consecutive CI failures (incremented by `emitRecordFailure`, reset by `emitClearFailures` on success)
- **iteration** field tracks total iteration attempts (incremented by `emitIncrementIteration` on entry to `iterating`/`iteratingFix`)
- **`maxFailuresReached` guard** compares failures against `MAX_CLAUDE_RETRIES` (default: 5, configured via `vars.MAX_CLAUDE_RETRIES`)
- **`shouldBlock` guard** = `maxFailuresReached` AND `ciFailed` — triggers blocked state
- The scenario starts mid-flow at `iteratingFix` (iteration=5, failures=5) to test the circuit breaker threshold

The critical distinction: **iteration** counts how many times Claude has run (always increments), while **failures** counts consecutive CI failures (resets on success). The circuit breaker triggers on failures, not iterations.

## State Transitions

### Step 1: 01-iteratingFix → 02-processingCI
**Input state:** iteration=5, failures=5, projectStatus="In progress", todos unchecked (1 remaining)
**Transition:** Claude runs fix attempt (mock: "iterate/fix-ci"), pushes code, CI runs.
**Output state:** iteration=6 (incremented on entry to iteratingFix), failures=5 (not yet updated), ciResult="failure"
**Why:** Entering `iteratingFix` increments iteration (5→6) via `emitIncrementIteration`. The iteration happens BEFORE Claude runs. CI then fails again, but the failure count hasn't been updated yet — that happens in `processingCI`.

### Step 2: 02-processingCI → 03-blocked
**Input state:** ciResult="failure", iteration=6, failures=5
**Transition:** Guard `shouldBlock` checks: `maxFailuresReached` (failures=5 >= MAX_CLAUDE_RETRIES=5) AND `ciFailed` (true). Both true → blocked.
**Output state:** projectStatus="Blocked", assignees=[] (bot unassigned), iteration=6, failures=5
**Why:** `emitBlockIssue` fires: sets projectStatus to Blocked, unassigns the bot (removes "nopo-bot" from assignees), logs the block event, and stops execution. Note that failures stays at 5 — the failure recording would have incremented it to 6, but the block takes priority.

## Expected Iteration History

No iteration history entries are asserted in this scenario. The scenario starts mid-flow (iteration=5, failures=5) — any prior history entries from earlier iterations are not part of this test fixture.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | iteratingFix | _(empty)_ | — |
| 02 | processingCI | _(empty)_ | — |
| 03 | blocked | _(empty)_ | — |

**Note:** In a real issue, the history would contain entries from previous iterations. This scenario focuses on the circuit breaker threshold, not history tracking.

## Expected Final State

- **projectStatus:** Blocked (circuit breaker triggered)
- **iteration:** 6 (5 from before + 1 increment on entry to iteratingFix)
- **failures:** 5 (the threshold that triggered the block)
- **assignees:** [] (bot unassigned to prevent further work)
- **todos:** Still unchecked (fix didn't work)
- **expected.maxFailuresReached:** true
- **expected.botUnassigned:** true

## Common Failure Modes

- **iteration != 6:** Iteration increments on entry to `iteratingFix`. If iteration is still 5, the `emitIncrementIteration` action didn't fire on state entry.
- **Not blocked at failures=5:** The `maxFailuresReached` guard checks `failures >= maxRetries`. If `MAX_CLAUDE_RETRIES` was changed or the guard uses `>` instead of `>=`, the threshold may not trigger.
- **Bot still assigned:** The `emitBlockIssue` action calls `emitUnassign`. If assignees still contains "nopo-bot", the unassign action didn't fire or was skipped.
- **failures incremented to 6:** If the failure recording happens before the block check, failures would be 6. The expected behavior is that the block fires at failures=5 (the threshold check happens before the failure is recorded for this CI run).
- **projectStatus != "Blocked":** The `emitSetBlocked` action sets the project field. If it's still "In progress", the block transition didn't complete.
