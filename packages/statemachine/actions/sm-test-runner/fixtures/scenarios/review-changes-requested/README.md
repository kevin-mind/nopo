# review-changes-requested

## What This Tests

Tests the review feedback loop: Claude reviews a PR and requests changes, which sends the issue back to iteration for fixes. The PR is converted to draft and iteration counter increments.

## State Machine Context

When Claude's review requests changes, the issue re-enters the iteration loop. Key mechanics:

- **`emitRunClaudePRReview`** runs Claude to review the PR, producing a structured review decision
- **`reviewRequestedChanges` guard** checks if the decision is "CHANGES_REQUESTED"
- **`emitPushToDraft`** converts the PR back to draft and removes the reviewer
- **`emitIncrementIteration`** increments on re-entry to `iterating` (the fix iteration)
- This creates the review feedback loop: iterate → CI → review → changes requested → iterate again

## State Transitions

### Step 1: 01-prReviewing → 02-processingReview
**Input state:** projectStatus="In review", iteration=1, todos=1/1 completed, pr.isDraft=false
**Transition:** Claude runs PR review via `emitRunClaudePRReview` with mock "review/changes-requested". Review produces CHANGES_REQUESTED decision.
**Output state:** reviewDecision="CHANGES_REQUESTED"
**Why:** Claude's review found issues that need to be addressed before the PR can be approved.

### Step 2: 02-processingReview → 03-iterating
**Input state:** reviewDecision="CHANGES_REQUESTED"
**Transition:** Guard `reviewRequestedChanges` is true → converts PR to draft, re-enters iteration. `emitPushToDraft` + `emitIncrementIteration`.
**Output state:** projectStatus="In progress", iteration=2 (incremented), pr.isDraft=true
**Why:** Changes requested means the code needs more work. The PR is converted to draft (preventing accidental merge), iteration increments (1→2) to track the new attempt, and Claude will run again to address the review feedback.

## Expected Iteration History

No iteration history entries are asserted in this scenario.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | prReviewing | _(empty)_ | — |
| 02 | processingReview | _(empty)_ | — |
| 03 | iterating | _(empty)_ | — |

## Expected Final State

- **projectStatus:** In progress (reverted from "In review")
- **iteration:** 2 (incremented from 1 — new iteration to address feedback)
- **pr.isDraft:** true (converted back to draft)
- **expected.prIsDraft:** true

## Common Failure Modes

- **iteration != 2:** Iteration should increment from 1→2 on re-entry to `iterating`. If still 1, `emitIncrementIteration` didn't fire. If 0, the initial iteration count was wrong.
- **PR still ready:** The PR must be converted to draft on changes requested. If isDraft is false, `emitConvertToDraft` failed.
- **projectStatus still "In review":** Must revert to "In progress" for the new iteration cycle.
- **Entered awaitingMerge:** If the guard misread the decision as APPROVED instead of CHANGES_REQUESTED, it would route to merge instead of back to iteration.
- **No re-iteration:** If the machine stops at processingReview without entering iterating, the routing for CHANGES_REQUESTED is broken.
