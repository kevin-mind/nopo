# pivot-revert

## What This Tests

Tests the /pivot command when attempting to revert completed work: instead of modifying closed sub-issues with completed todos, a new reversion sub-issue is created with todos for the rollback work.

## State Machine Context

Reverting completed work is the most complex pivot case. Key mechanics:

- **Safety constraint:** Completed (checked) todos and CLOSED sub-issues are NEVER modified
- When a pivot requires undoing completed work, a new `[Reversion]` sub-issue is created
- The reversion sub-issue contains todos for the rollback (e.g., "remove OAuth2 library", "add JWT generation")
- The new sub-issue gets projectStatus="Ready" so it can be worked on
- The parent body is updated to reflect the new direction

## State Transitions

### Step 1: 01-pivoting → 02-done
**Input state:** trigger="issue-pivot", projectStatus="In progress", iteration=5, pivotDescription="Switch from OAuth2 to JWT-based authentication. Remove the OAuth2 library and endpoints, and add todos for implementing JWT token generation and validation instead. Keep the session management."
3 sub-issues: Phase 1 (OAuth2 setup, CLOSED/Done, 2 completed todos), Phase 2 (Auth endpoints, CLOSED/Done, 2 completed todos), Phase 3 (Rate limiting, OPEN/In progress, 1 unchecked todo)
**Transition:** Guard `triggeredByPivot` matches. Runs `emitRunClaudePivot` with mock "pivot/revert-checked-todo". Claude creates a reversion sub-issue instead of modifying closed phases.
**Output state:** First 2 sub-issues unchanged (still CLOSED/Done). 4th sub-issue created: "[Reversion] Switch from OAuth2 to JWT authentication" with projectStatus="Ready" and 4 todos (remove OAuth2 library, remove endpoints, add JWT generation, add JWT validation). Parent body updated to mention JWT.
**Why:** Phases 1 and 2 are CLOSED with completed todos — they cannot be modified. Instead, a new reversion sub-issue is created that contains the work needed to undo the OAuth2 implementation and replace it with JWT. This preserves the audit trail of what was done and what needs to change.

## Expected Iteration History

No iteration history entries are expected.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | pivoting | _(empty)_ | — |
| 02 | done | _(empty)_ | — |

## Expected Final State

- **Sub-issues 1-2:** Unchanged (CLOSED, Done, completed todos preserved)
- **Sub-issue 3:** Unchanged (OPEN, In progress)
- **Sub-issue 4 (NEW):** "[Reversion] Switch from OAuth2 to JWT authentication"
  - projectStatus: "Ready"
  - 4 todos: remove OAuth2 library, remove OAuth2 endpoints, add JWT generation, add JWT validation
- **Parent body:** Updated to mention JWT instead of OAuth2
- **expected.newSubIssueCreated:** true
- **expected.completedWorkPreserved:** true
- **expected.todosAdded.min:** 2

## Common Failure Modes

- **Closed sub-issues modified:** Phases 1-2 must remain CLOSED with their completed todos intact. If any completed todo was removed or a closed sub-issue was reopened, the safety constraint failed.
- **No reversion sub-issue created:** If no new sub-issue was created, the pivot incorrectly tried to modify closed sub-issues or failed silently.
- **Reversion sub-issue missing todos:** The reversion must include specific rollback todos. If the todo list is empty, the mock output wasn't applied.
- **Reversion sub-issue status wrong:** Should be "Ready" so it can be immediately worked on.
- **Parent body not updated:** The parent should reflect the new JWT direction.
