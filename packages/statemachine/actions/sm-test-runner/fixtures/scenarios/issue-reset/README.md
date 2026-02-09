# issue-reset

## What This Tests

Tests the /reset slash command: resets a blocked issue back to its initial state (Backlog), clearing failures, unassigning the bot, and clearing agent notes. The iteration counter is preserved.

## State Machine Context

The reset command provides a manual recovery mechanism. Key mechanics:

- **`triggeredByReset` guard** detects the `issue-reset` trigger
- **`emitResetIssue`** performs the reset: sets projectStatus to "Backlog", clears failures to 0, unassigns the bot, clears agentNotes
- **iteration is NOT reset** — it preserves the historical count of how many times Claude has run
- This is useful when an issue is stuck in Blocked/Error state and needs manual intervention

## State Transitions

### Step 1: 01-resetting → 02-done
**Input state:** trigger="issue-reset", projectStatus="Blocked", iteration=5, failures=3, assignees=["nopo-bot"], agentNotes=[{error message}]
**Transition:** Guard `triggeredByReset` matches. Enters `resetting` state, runs `emitResetIssue`.
**Output state:** projectStatus="Backlog", iteration=5 (preserved), failures=0, assignees=[], agentNotes=[]
**Why:** Reset clears the error state so the issue can be re-assigned and re-worked. Failures reset to 0 so the circuit breaker won't immediately trigger again. The bot is unassigned so a human can re-assign when ready. Iteration stays at 5 to maintain the audit trail.

## Expected Iteration History

No iteration history entries are asserted in this scenario.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | resetting | _(empty)_ | — |
| 02 | done | _(empty)_ | — |

**Note:** In a real issue, existing history entries from prior iterations would remain. The reset does not clear iteration history.

## Expected Final State

- **projectStatus:** Backlog (reset from Blocked)
- **iteration:** 5 (preserved — not reset)
- **failures:** 0 (cleared)
- **assignees:** [] (bot unassigned)
- **agentNotes:** [] (cleared)
- **expected.projectStatus:** Backlog
- **expected.failures:** 0
- **expected.assigneesEmpty:** true

## Common Failure Modes

- **failures not cleared:** `emitResetIssue` must set failures to 0. If still 3, the reset action didn't fully execute.
- **Bot still assigned:** The reset must unassign the bot. If assignees still contains "nopo-bot", the unassign action failed.
- **iteration changed:** Iteration should NOT be modified by reset. If it changed from 5, the reset action is incorrectly resetting the iteration counter.
- **projectStatus != "Backlog":** The reset sets status to Backlog. If it's still "Blocked" or became something else, the status-setting action has a bug.
- **agentNotes not cleared:** Reset should clear agent notes. If they persist, the clear action didn't fire.
