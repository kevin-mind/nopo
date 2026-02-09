# pr-push-during-review

## What This Tests

Tests the push-during-review flow: when code is pushed to a PR that's currently in review, the PR is converted back to draft and the issue returns to iteration mode.

## State Machine Context

A push during review signals that the code has changed since the review started. Key mechanics:

- **`triggeredByPush` guard** detects the `pr-push` trigger
- **`emitConvertToDraft`** converts the PR from ready back to draft
- **`emitPushToDraft`** is the compound action: converts to draft, removes reviewer, logs the event
- The push invalidates the current review — the code needs to go through CI again before re-requesting review
- projectStatus changes from "In review" back to "In progress"

## State Transitions

### Step 1: 01-reviewing → 02-prPush
**Input state:** trigger="pr-push", projectStatus="In review", todos=2 total (1 completed), pr.isDraft=false
**Transition:** Guard `triggeredByPush` detects push event during review state. Routes to `prPush`.
**Output state:** projectStatus="In progress", pr.isDraft=true (converted to draft)
**Why:** The push invalidates the review. `emitPushToDraft` converts the PR to draft (preventing merge of un-reviewed code), removes the reviewer assignment, and sets status back to "In progress". The issue will go through another CI cycle before review can be re-requested.

## Expected Iteration History

No iteration history entries are asserted.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | reviewing | _(empty)_ | — |
| 02 | prPush | _(empty)_ | — |

## Expected Final State

- **projectStatus:** In progress (reverted from "In review")
- **pr.isDraft:** true (converted back to draft)
- **expected.prIsDraft:** true

## Common Failure Modes

- **PR still ready:** The push handler must convert the PR to draft. If isDraft is still false, `emitConvertToDraft` didn't fire.
- **projectStatus still "In review":** The status must revert to "In progress" on push. If unchanged, the status action didn't fire.
- **Review not cancelled:** The reviewer should be removed when converting to draft. If the reviewer is still assigned, `emitPushToDraft` didn't fully execute.
- **Entered wrong state:** If the machine routes to `reviewing` (for the review) instead of `prPush` (for the push), the trigger detection priority is wrong.
