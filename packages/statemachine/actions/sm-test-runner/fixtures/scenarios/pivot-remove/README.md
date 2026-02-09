# pivot-remove

## What This Tests

Tests the /pivot command for removing unchecked todos from a sub-issue. The pivot removes the "comprehensive logging" todo, keeping only basic logging todos.

## State Machine Context

The /pivot command with a subtractive change. Key mechanics:

- **`emitRunClaudePivot`** runs Claude to analyze and execute the pivot
- Safety constraint: only UNCHECKED todos can be removed — checked (completed) todos are preserved
- The parent issue body is also updated to reflect the scope change
- This tests the pivot's ability to reduce scope without losing completed work

## State Transitions

### Step 1: 01-pivoting → 02-done
**Input state:** trigger="issue-pivot", pivotDescription="Remove the comprehensive logging todo - we'll use basic logging only", sub-issue "[Phase 1]: Core logging setup" has 3 todos (all unchecked)
**Transition:** Guard `triggeredByPivot` matches. Runs `emitRunClaudePivot` with mock "pivot/remove-unchecked-todo". Claude removes the comprehensive logging todo.
**Output state:** Sub-issue has 2 todos (removed 1), parent body updated to mention basic logging only
**Why:** The pivot reduces scope by removing the comprehensive logging todo. Since it was unchecked (not yet implemented), it's safe to remove. The parent body is updated to reflect the decision to use basic logging only.

## Expected Iteration History

No iteration history entries are expected.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | pivoting | _(empty)_ | — |
| 02 | done | _(empty)_ | — |

## Expected Final State

- **Sub-issue todos:** 2 (was 3, removed "Add comprehensive logging")
- **Parent body:** Updated to mention basic logging only
- **expected.subIssuesModified:** true

## Common Failure Modes

- **Todo not removed:** If still 3 todos, the removal didn't execute. Check that the mock output correctly identifies which todo to remove.
- **Wrong todo removed:** If a different todo was removed, the pivot's scope matching is wrong.
- **Checked todo removed:** If a completed todo was removed, the safety constraint failed. Only unchecked todos should be removable.
- **Parent body not updated:** The parent should be updated to reflect the scope reduction.
