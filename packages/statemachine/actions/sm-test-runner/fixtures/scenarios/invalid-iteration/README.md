# invalid-iteration

## What This Tests

Tests the error state when a parent issue (without sub-issues) tries to iterate. Parent issues should only orchestrate sub-issues, never iterate directly. This is a fatal configuration error.

## State Machine Context

The state machine enforces that parent issues orchestrate and sub-issues iterate. Key mechanics:

- **Detection routing** checks if the issue is a parent (has "groomed" label, is in progress, bot assigned) but has no sub-issues
- **`emitLogInvalidIteration`** fires when this invalid state is detected, setting projectStatus to "Error"
- This guard prevents a parent issue from entering the iteration loop, which would be incorrect — parents should create sub-issues during grooming and then orchestrate them
- The error state is terminal — manual intervention is required

## State Transitions

### Step 1: 01-detecting → 02-invalidIteration
**Input state:** projectStatus="In progress", iteration=1, labels=["enhancement","triaged","groomed"], hasSubIssues=false, todos=1 unchecked
**Transition:** Detection routing finds: bot assigned + groomed + in progress + no sub-issues → invalid state. Routes to `invalidIteration`.
**Output state:** projectStatus="Error"
**Why:** A groomed parent issue in progress should have sub-issues to orchestrate. Without sub-issues, there's nothing to delegate work to. The machine flags this as an error rather than attempting to iterate on the parent directly.

## Expected Iteration History

No iteration history entries are expected. The error is detected before any iteration occurs.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | detecting | _(empty)_ | — |
| 02 | invalidIteration | _(empty)_ | — |

## Expected Final State

- **projectStatus:** Error (fatal configuration error)
- **expected.projectStatus:** Error

## Common Failure Modes

- **Entered iterating instead of error:** If the machine routes to `iterating`, the guard that checks for missing sub-issues isn't firing. The detection routing should catch this case before entering the iteration state.
- **projectStatus != "Error":** The `emitLogInvalidIteration` action must set the project status. If it stays "In progress", the error action didn't fire.
- **False positive:** If a legitimate sub-issue (not a parent) hits this state, the `hasSubIssues` check may be incorrect or the issue metadata is wrong.
