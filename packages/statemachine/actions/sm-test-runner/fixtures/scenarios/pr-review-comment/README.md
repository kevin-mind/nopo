# pr-review-comment

## What This Tests

Tests the PR review with a COMMENTED decision: the reviewer left comments but neither approved nor requested changes. The PR stays in review state, awaiting a more decisive review.

## State Machine Context

A COMMENTED review is informational — it doesn't trigger any workflow transition. Key mechanics:

- **`reviewCommented` guard** checks if the review decision is "COMMENTED"
- When the review is only a comment (no approval/rejection), the PR stays ready and the issue stays in review
- This is distinct from APPROVED (proceeds to merge) and CHANGES_REQUESTED (returns to iteration)
- The machine effectively no-ops on comment reviews — it acknowledges the review but takes no action

## State Transitions

### Step 1: 01-reviewing → 02-processingReview
**Input state:** trigger="pr-review-submitted", projectStatus="In review", todos=1/1 completed, pr.isDraft=false
**Transition:** Review submitted event detected. Enters `processingReview` to evaluate the decision.
**Output state:** reviewDecision="COMMENTED"
**Why:** The reviewer left comments but didn't approve or request changes. The processing state evaluates this as a no-op transition.

## Expected Iteration History

No iteration history entries are asserted.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | reviewing | _(empty)_ | — |
| 02 | processingReview | _(empty)_ | — |

## Expected Final State

- **projectStatus:** In review (unchanged)
- **pr.isDraft:** false (still ready — not converted to draft)
- **expected.prMarkedReady:** true

## Common Failure Modes

- **PR converted to draft:** Comment reviews should NOT convert the PR to draft. If isDraft became true, the machine incorrectly treated this as CHANGES_REQUESTED.
- **Entered iterating:** The machine should NOT re-enter iteration on a comment review. If it did, the `reviewCommented` guard didn't fire or the routing priority is wrong.
- **projectStatus changed:** Status should remain "In review". If it changed to "In progress", the machine treated the comment as changes requested.
