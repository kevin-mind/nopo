# pivot-simple

## What This Tests

Tests the simplest /pivot command: adding a single new todo to an existing sub-issue. The pivot description specifies what to add, and Claude modifies the sub-issue's todo list accordingly.

## State Machine Context

The /pivot command allows mid-flight specification changes. Key mechanics:

- **`triggeredByPivot` guard** detects the `issue-pivot` trigger
- **`emitRunClaudePivot`** runs Claude with the pivot description and current issue state
- Claude analyzes the pivot request and modifies todos on the appropriate sub-issue(s)
- Safety constraint: completed (checked) todos cannot be removed — only unchecked todos can be modified
- The pivot is a one-shot operation — it modifies and exits to `done`

## State Transitions

### Step 1: 01-pivoting → 02-done
**Input state:** trigger="issue-pivot", projectStatus="In progress", iteration=2, pivotDescription="Add password reset functionality to the authentication system - we need a todo for implementing the password reset endpoint and email flow", 2 sub-issues with 2 todos each
**Transition:** Guard `triggeredByPivot` matches. Runs `emitRunClaudePivot` with mock "pivot/simple-add-todo". Claude adds a new todo to the first sub-issue.
**Output state:** First sub-issue now has 3 todos (added password reset), second sub-issue unchanged
**Why:** The pivot analysis determined the password reset todo belongs in the first sub-issue (closest scope match). Only the relevant sub-issue is modified.

## Expected Iteration History

No iteration history entries are expected. Pivots don't modify iteration history.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | pivoting | _(empty)_ | — |
| 02 | done | _(empty)_ | — |

## Expected Final State

- **Sub-issue 1 todos:** 3 (was 2, added 1 for password reset)
- **Sub-issue 2 todos:** 2 (unchanged)
- **expected.subIssuesModified:** true

## Common Failure Modes

- **Todo added to wrong sub-issue:** Claude must determine the correct sub-issue based on scope. If the todo was added to the second sub-issue, the mock's scope matching is wrong.
- **No todo added:** If the sub-issue still has 2 todos, the pivot action didn't modify the todo list.
- **Existing todos modified:** The pivot should only ADD the new todo, not change existing ones.
- **Parent issue modified:** Simple pivots should only modify sub-issues, not the parent.
