# slash-lfg

## What This Tests

Tests the /lfg slash command that starts or resumes work on an issue. When triggered via assignment, the issue enters the iterating state where Claude implements the feature.

## State Machine Context

The /lfg command (and its aliases /implement, /continue) triggers iteration on an issue. Key mechanics:

- **`triggeredByAssignment` guard** detects the `issue-assigned` trigger (assignment of nopo-bot)
- **`emitIncrementIteration`** increments the iteration counter on entry to `iterating`
- **`emitRunClaude`** runs Claude with the iterate prompt to implement the feature
- The issue must already be triaged and groomed (has both labels) before iteration can start
- After Claude completes, todos are marked done and the machine reaches `done` for this invocation

## State Transitions

### Step 1: 01-iterating → 02-done
**Input state:** trigger="issue-assigned", projectStatus="In progress", iteration=0, todos=3 unchecked, labels=["triaged","enhancement","groomed"]
**Transition:** Guard routes to `iterating`. On entry: `emitIncrementIteration` (0→1), `emitSetWorking`, `emitRunClaude`.
**Output state:** iteration=1, todos=3/3 completed, agentNotes=[{type:"info", message:"All implementation tasks completed"}]
**Why:** Iteration increments immediately on entry (before Claude runs). Claude implements the feature using the mock "iterate/perfect-code", which completes all todos. The agentNotes are added by Claude during implementation.

## Expected Iteration History

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | iterating | _(empty)_ | — |
| 02 | done | _(empty)_ | — |

**Note:** History entries would be added during the iterating step (⏳ Iterating), but the fixture doesn't assert on history for this scenario — it focuses on verifying the /lfg trigger and iteration mechanics.

## Expected Final State

- **projectStatus:** In progress (set by `emitSetWorking`)
- **iteration:** 1 (incremented from 0 on entry)
- **todos:** 3/3 completed (Claude completed all tasks)
- **expected.finalState:** iterating

## Common Failure Modes

- **iteration != 1:** Iteration should increment from 0→1 on entry to `iterating`. If still 0, `emitIncrementIteration` didn't fire.
- **Todos not completed:** The mock "iterate/perfect-code" should mark all todos as done. If unchecked, the mock output wasn't applied.
- **Wrong state entered:** If the machine routes to `triaging` or `grooming` instead of `iterating`, the guard priority is wrong — assigned + triaged + groomed should route to iterating.
- **trigger mismatch:** The /lfg command triggers via `issue-assigned`. If the trigger detection fails, the machine may enter detection routing instead.
