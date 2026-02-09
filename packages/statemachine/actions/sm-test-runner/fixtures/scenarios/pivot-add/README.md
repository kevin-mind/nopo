# pivot-add

## What This Tests

Tests the /pivot command for adding new todos to a sub-issue. Specifically, adding WebSocket rate limiting todos to an existing rate limiting sub-issue.

## State Machine Context

The /pivot command with an additive change. Key mechanics:

- **`triggeredByPivot` guard** detects the `issue-pivot` trigger
- **`emitRunClaudePivot`** runs Claude to analyze the pivot and modify the issue
- The pivot adds new scope without removing existing work
- Only unchecked todos can be modified — completed work is preserved

## State Transitions

### Step 1: 01-pivoting → 02-done
**Input state:** trigger="issue-pivot", projectStatus="In progress", pivotDescription="Also add rate limiting for WebSocket connections", sub-issue "[Phase 1]: Core rate limiting" has 2 todos
**Transition:** Guard `triggeredByPivot` matches. Runs `emitRunClaudePivot` with mock "pivot/add-websocket-ratelimit". Claude adds WebSocket rate limiting todo.
**Output state:** Sub-issue now has 3 todos (added WebSocket rate limiting)
**Why:** The pivot adds new scope (WebSocket rate limiting) to the existing rate limiting phase. The existing 2 todos are preserved, and a new one is appended.

## Expected Iteration History

No iteration history entries are expected. Pivots don't modify iteration history.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | pivoting | _(empty)_ | — |
| 02 | done | _(empty)_ | — |

## Expected Final State

- **Sub-issue todos:** 3 (was 2, added 1)
- **expected.subIssuesModified:** true

## Common Failure Modes

- **Todo count wrong:** Should go from 2→3. If still 2, the add failed. If more than 3, extra todos were created.
- **Existing todos modified:** The original 2 todos should be unchanged — only a new one appended.
- **Wrong sub-issue modified:** The todo should be added to the rate limiting sub-issue, not a different one.
