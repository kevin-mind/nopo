# full-flow

## What This Tests

Complete sub-issue lifecycle from initial detection through triage, grooming, implementation, CI, review, approval, merge, and closure. This is the happy path through every major state in the machine.

## State Machine Context

This scenario exercises a sub-issue (has a parent issue) going through the entire lifecycle. Key mechanics:

- **Detection** routes to triage because the issue has no labels/status
- **Triage** runs Claude to classify and structure the issue body (adds labels, sets projectStatus to Backlog)
- **Grooming** runs 4 parallel Claude agents (PM, Engineer, QA, Research) plus a summary agent, adds "groomed" label
- **Iteration** increments the iteration counter on entry, runs Claude to implement, marks todos complete
- **CI Processing** checks `ciResult` — success + todos done triggers transition to review
- **Review Transition** clears failures, marks PR ready, sets projectStatus to "In review", requests reviewer
- **Review** runs Claude PR review, which produces an APPROVED decision
- **Merge** closes the issue and sets projectStatus to "Done"

The iteration counter increments when entering `iterating` (via `emitIncrementIteration`), NOT when CI completes. Failures reset to 0 on successful CI via `emitClearFailures`.

## State Transitions

### Step 1: 01-detecting → 02-triaging
**Input state:** projectStatus=null, iteration=0, labels=[], no "triaged" label
**Transition:** Guard `needsTriage` is true (no "triaged" label). Routes to triaging.
**Output state:** projectStatus="Backlog", labels=["enhancement","priority:medium","topic:testing","triaged"], body restructured with Approach/Iteration History sections
**Why:** Triage adds classification labels, structures the body, and sets initial project status. The "triaged" label prevents re-triage.

### Step 2: 02-triaging → 03-grooming
**Input state:** labels include "triaged" but NOT "groomed", trigger="issue-groom"
**Transition:** Guard `needsGrooming` is true (triaged but not groomed). Routes to grooming.
**Output state:** labels gain "groomed", body may be further refined
**Why:** Grooming runs 4 parallel analysis agents to deeply assess the issue before implementation begins.

### Step 3: 03-grooming → 04-iterating
**Input state:** labels include ["triaged","groomed"], projectStatus="Backlog", iteration=0
**Transition:** Bot assigned + groomed → ready to iterate. Guard `isGroomed` passes.
**Output state:** projectStatus="In progress", iteration=1, assignees=["nopo-bot"], todos populated (2 unchecked)
**Why:** Entering iterating increments iteration (0→1), sets status to working, and runs Claude to implement. The 2 todos come from the structured issue body.

### Step 4: 04-iterating → 05-processingCI
**Input state:** iteration=1, failures=0, todos unchecked, Claude has pushed code
**Transition:** CI run completes → `DETECT` event with `triggeredByCI`.
**Output state:** ciResult="success", todos all checked (2/2), history=["⏳ Iterating"]
**Why:** Claude's implementation checked off all todos. CI ran and passed. The "⏳ Iterating" history entry was added when iteration started.

### Step 5: 05-processingCI → 06-transitioningToReview
**Input state:** ciResult="success", todos done (uncheckedNonManual=0)
**Transition:** Guard `readyForReview` = ciPassed AND todosDone. Both true → transition to review.
**Output state:** projectStatus="In review", history=["✅ CI Passed"]
**Why:** The ⏳ history entry is updated to ✅ on CI success. `emitTransitionToReview` clears failures, marks PR ready, sets review status.

### Step 6: 06-transitioningToReview → 07-reviewing
**Input state:** projectStatus="In review", PR marked ready
**Transition:** Review requested → `DETECT` with `triggeredByReviewRequest`.
**Output state:** history=["👀 Review requested"]
**Why:** After PR is marked ready and reviewer assigned, the review-requested event fires, entering the reviewing state where Claude performs the PR review.

### Step 7: 07-reviewing → 08-processingReview
**Input state:** Claude review running
**Transition:** Review submitted → `DETECT` with review results.
**Output state:** Review decision available (APPROVED in this scenario)
**Why:** Claude's PR review produces a structured decision. The `processingReview` state evaluates this decision.

### Step 8: 08-processingReview → 09-awaitingMerge
**Input state:** reviewDecision="APPROVED"
**Transition:** Guard `reviewApproved` is true → route to awaitingMerge.
**Output state:** PR remains ready (not draft), awaiting human merge
**Why:** Approved review means the PR is ready. The bot doesn't auto-merge — it waits for a human to merge.

### Step 9: 09-awaitingMerge → 10-processingMerge
**Input state:** PR approved, awaiting merge
**Transition:** Human merges the PR → `DETECT` with `triggeredByMerge`.
**Output state:** Merge processing begins
**Why:** The merge event triggers final cleanup actions.

### Step 10: 10-processingMerge → 11-done
**Input state:** PR merged
**Transition:** Merge processed → transition to done.
**Output state:** issue.state="CLOSED", projectStatus="Done", history=["🚢 Merged"]
**Why:** `emitCloseIssue` closes the issue, `emitSetDone` sets project status. The issueClosed expected field validates this.

## Expected Iteration History

The `history` array tracks iteration lifecycle events. Entries are appended via `emitAppendHistory` or updated in-place via `emitUpdateHistory` (e.g., ⏳→✅).

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | detecting | _(empty)_ | — |
| 02 | triaging | _(empty)_ | — |
| 03 | grooming | _(empty)_ | — |
| 04 | iterating | _(empty)_ | — |
| 05 | processingCI | `["⏳ Iterating"]` | `emitLogIterationStarted` appended on entry to iterating |
| 06 | transitioningToReview | `["✅ CI Passed"]` | `emitLogCISuccess` updates ⏳→✅ via pattern match |
| 07 | reviewing | `["👀 Review requested"]` | `emitLogReviewRequested` appended on review request |
| 08 | processingReview | _(empty)_ | — |
| 09 | awaitingMerge | _(empty)_ | — |
| 10 | processingMerge | _(empty)_ | — |
| 11 | done | `["🚢 Merged"]` | `emitMerged` appended on merge |

**Note:** The fixture's `history` field at each step contains only the entries the test asserts, not necessarily the full cumulative history.

## Expected Final State

- **issue.state:** CLOSED (PR was merged, issue auto-closed)
- **projectStatus:** Done
- **iteration:** 1 (only one iteration needed — happy path)
- **failures:** 0 (CI passed first try)
- **todos:** 2/2 completed
- **history:** ["🚢 Merged"]

## Common Failure Modes

- **iteration != 1:** Iteration increments on entry to `iterating`/`iteratingFix`. If iteration is 0, the increment action didn't fire. If > 1, the scenario re-entered iterating unexpectedly.
- **projectStatus stuck at "In progress":** The `readyForReview` guard requires BOTH `ciPassed` AND `todosDone`. If todos aren't marked complete, it won't transition to review.
- **issue not closed:** The `emitCloseIssue` action fires in the merge processing step. If the issue stays OPEN, the merge flow didn't complete.
- **Missing labels:** Triage adds labels atomically. If "triaged" is missing, the triage Claude mock may not have produced valid output.
- **History mismatch:** History entries are added/updated at specific transitions. "⏳ Iterating" on iteration start, updated to "✅ CI Passed" on success, "👀 Review requested" on review, "🚢 Merged" on merge.
