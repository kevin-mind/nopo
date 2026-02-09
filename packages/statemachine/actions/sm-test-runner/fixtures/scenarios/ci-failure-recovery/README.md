# ci-failure-recovery

## What This Tests

Tests recovery from a CI failure: Claude iterates, CI fails, Claude fixes the issue, CI passes, and the issue transitions to review. Validates that the failure counter increments on failure and resets on success.

## State Machine Context

CI failure recovery is the normal fix loop (as opposed to circuit-breaker which tests the maximum failure threshold). Key mechanics:

- **`ciFailed` guard** detects CI failure → routes to `iteratingFix` (not regular `iterating`)
- **`emitRecordFailure`** increments the failures counter on CI failure
- **`emitRunClaudeFixCI`** runs Claude with CI failure context (error logs, failed checks)
- **`emitClearFailures`** resets failures to 0 on CI success
- **`readyForReview` guard** = `ciPassed` AND `todosDone` — triggers review transition
- The distinction between `iterating` and `iteratingFix` is the prompt: fix gets CI failure context

## State Transitions

### Step 1: 01-iterating → 02-processingCI
**Input state:** iteration=0, failures=0, todos=1 unchecked, mock="iterate/broken-code"
**Transition:** Claude iterates with the "broken-code" mock (intentionally produces failing code). CI runs and fails.
**Output state:** iteration=1, failures=0 (not yet updated), ciResult="failure", todos=1/1 completed, history=["⏳ Iterating"]
**Why:** Iteration increments on entry (0→1). The mock marks todos as complete but produces code that fails CI. The history entry "⏳ Iterating" is added on entry to iterating.

### Step 2: 02-processingCI → 03-iteratingFix
**Input state:** ciResult="failure", iteration=1, failures=0
**Transition:** Guard `ciFailed` is true, `shouldBlock` is false (failures=0 < maxRetries). Routes to `iteratingFix`. `emitRecordFailure` increments failures (0→1). `emitIncrementIteration` increments iteration (1→2).
**Output state:** iteration=2, failures=1, ciResult="success" (for the NEXT CI check)
**Why:** CI failed but we haven't hit the max retries, so the machine enters `iteratingFix` to try fixing the issue. Failures increment to track consecutive failures. Iteration increments because this is a new attempt.

### Step 3: 03-iteratingFix → 04-transitioningToReview
**Input state:** iteration=2, failures=1, todos all completed, mock="iterate/fix-ci"
**Transition:** Claude runs with CI failure context via `emitRunClaudeFixCI`. Pushes fixed code. CI passes. Guard `readyForReview` = ciPassed AND todosDone → true. `emitClearFailures` resets failures (1→0). Transitions to review.
**Output state:** projectStatus="In review", iteration=2, failures=0 (cleared on success)
**Why:** The fix worked — CI passes. Failures reset to 0 because the streak of consecutive failures is broken. The `readyForReview` guard fires because both conditions (CI pass + todos done) are met.

## Expected Iteration History

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | iterating | _(empty)_ | — |
| 02 | processingCI | `["⏳ Iterating"]` | `emitLogIterationStarted` appended on entry to iterating |
| 03 | iteratingFix | _(empty)_ | — |
| 04 | transitioningToReview | _(empty)_ | — |

**Note:** The ⏳ entry is asserted in step 02. After CI success in step 03→04, it would be updated to ✅, but the fixture doesn't assert this.

## Expected Final State

- **projectStatus:** In review (transitioned after CI pass + todos done)
- **iteration:** 2 (two iterations: initial + fix)
- **failures:** 0 (cleared on CI success)
- **todos:** 1/1 completed

## Common Failure Modes

- **failures != 0 after recovery:** `emitClearFailures` must reset to 0 on CI success. If failures is 1, the clear action didn't fire.
- **iteration != 2:** Two iterations total: initial (0→1) and fix (1→2). If 1, the increment on entry to `iteratingFix` didn't fire.
- **Entered `iterating` instead of `iteratingFix`:** After CI failure, the machine should enter `iteratingFix` (which has CI context in the prompt), not regular `iterating`.
- **Blocked unexpectedly:** The circuit breaker shouldn't trigger — failures=0 at the time of the first CI failure, well below the threshold of 5.
- **Not transitioned to review:** Both `ciPassed` AND `todosDone` must be true. If todos aren't completed, the transition guard won't fire.
