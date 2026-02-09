# pr-review-approved

## What This Tests

Tests the PR review approval flow: a PR in review receives an APPROVED review decision, then transitions to awaiting merge where a human can merge it.

## State Machine Context

PR review processing evaluates the review decision and routes accordingly. Key mechanics:

- **`triggeredByReviewSubmitted` guard** detects the `pr-review-submitted` trigger
- **`reviewApproved` guard** checks if the review decision is "APPROVED"
- **`emitMarkReady`** ensures the PR is marked as ready (not draft) for merge
- After approval, the machine enters `awaitingMerge` — the bot does NOT auto-merge
- The human must manually merge the PR (triggering the merge flow separately)

## State Transitions

### Step 1: 01-reviewing → 02-processingReview
**Input state:** trigger="pr-review-submitted", projectStatus="In review", todos=2/2 completed, pr.isDraft=false
**Transition:** Review submitted event detected. Enters `processingReview` to evaluate the decision.
**Output state:** reviewDecision="APPROVED"
**Why:** The review submission carries the decision. Processing evaluates which path to take based on the decision value.

### Step 2: 02-processingReview → 03-awaitingMerge
**Input state:** reviewDecision="APPROVED"
**Transition:** Guard `reviewApproved` is true → routes to `awaitingMerge`.
**Output state:** pr.isDraft=false (confirmed ready), projectStatus="In review" (unchanged)
**Why:** Approval means the PR is ready for merge. `emitMarkReady` ensures the PR isn't in draft state. The machine stops here — merging is a human action.

## Expected Iteration History

No iteration history entries are asserted in this scenario. The scenario focuses on the review→merge transition.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | reviewing | _(empty)_ | — |
| 02 | processingReview | _(empty)_ | — |
| 03 | awaitingMerge | _(empty)_ | — |

## Expected Final State

- **projectStatus:** In review (unchanged — stays in review until merged)
- **pr.isDraft:** false (PR is ready for merge)
- **expected.prIsDraft:** false
- **expected.prMarkedReady:** true

## Common Failure Modes

- **PR still in draft:** `emitMarkReady` should ensure the PR is ready. If isDraft is true, the action didn't fire.
- **Routed to iterating instead:** If the decision guard misread "APPROVED" or the guard priority is wrong, the machine might re-enter iteration.
- **Auto-merged:** The machine should NOT merge the PR. If the PR was merged, `emitMergePR` fired when it shouldn't have.
- **projectStatus changed:** Status should stay "In review" until the merge event fires. If it changed, an unexpected action modified it.
