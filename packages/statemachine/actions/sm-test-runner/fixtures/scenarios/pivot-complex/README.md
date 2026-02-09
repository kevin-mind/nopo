# pivot-complex

## What This Tests

Tests the most complex /pivot case: a pivot that affects the parent issue AND multiple sub-issues simultaneously — modifying existing sub-issues, creating a new sub-issue, and updating the parent body.

## State Machine Context

Complex pivots can modify the entire issue hierarchy. Key mechanics:

- **`emitRunClaudePivot`** runs Claude with the full issue context (parent + all sub-issues)
- Claude can: modify unchecked todos on existing sub-issues, create new sub-issues, update the parent body
- Safety constraints still apply: completed todos and closed sub-issues are never modified
- The parent body update reflects the architectural change across all phases

## State Transitions

### Step 1: 01-pivoting → 02-done
**Input state:** trigger="issue-pivot", issue="Database migration system", projectStatus="In progress", iteration=3, parent has 1 todo ("Implement caching layer"), 2 sub-issues:
- Phase 1 "Schema migrations" (2 todos)
- Phase 2 "Data migrations" (2 todos)
pivotDescription="Split the database migration into schema and data phases, add rollback support to schema migrations, batch the data migrations, and add a caching layer phase"
**Transition:** Guard `triggeredByPivot` matches. Runs `emitRunClaudePivot` with mock "pivot/complex-multi-issue". Claude modifies both sub-issues and creates a new one.
**Output state:**
- Parent body updated (mentions split phases, caching layer), parent todos=0 (caching layer moved to new sub-issue)
- Phase 1 modified: 2 todos (removed transaction, added rollback)
- Phase 2 modified: 3 todos (added batching)
- Phase 3 NEW: "[Phase 3]: Implement caching layer" with 3 todos
**Why:** The pivot restructures the entire project: schema migrations get rollback support, data migrations get batching, and the caching layer (previously a parent todo) becomes its own phase. This demonstrates the pivot's ability to coordinate changes across the full hierarchy.

## Expected Iteration History

No iteration history entries are expected.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | pivoting | _(empty)_ | — |
| 02 | done | _(empty)_ | — |

## Expected Final State

- **Parent body:** Updated to reflect restructured phases
- **Parent todos:** 0 (caching layer moved to sub-issue)
- **Phase 1 (Schema migrations):** Modified — 2 todos (removed transaction support, added rollback)
- **Phase 2 (Data migrations):** Modified — 3 todos (added batching)
- **Phase 3 (NEW - Caching layer):** 3 todos
- **expected.parentIssueModified:** true
- **expected.subIssuesModified:** true
- **expected.newSubIssueCreated:** true

## Common Failure Modes

- **Parent todo not moved:** The "Implement caching layer" todo should move from the parent to the new Phase 3 sub-issue. If it's still on the parent, the move logic failed.
- **Wrong sub-issues modified:** Only Phase 1 and Phase 2 should be modified. If the wrong sub-issue was changed, the pivot's scope matching is wrong.
- **New sub-issue not created:** Phase 3 must be created as a new sub-issue. If missing, the create logic failed.
- **Todo counts wrong:** Phase 1 should have 2 (modified, not added), Phase 2 should have 3 (added 1), Phase 3 should have 3 (all new).
- **Completed todos modified:** If any checked todos were changed, the safety constraint failed.
