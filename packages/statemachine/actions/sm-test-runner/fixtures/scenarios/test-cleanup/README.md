# test-cleanup

## What This Tests

Tests the /reset command on a fully completed issue with sub-issues: reopens the issue and all sub-issues, resets project statuses to Backlog/Ready, clears iteration and failure counters, and unassigns the bot.

## State Machine Context

This is a more complex reset than `issue-reset` — it handles a completed parent issue with closed sub-issues. Key mechanics:

- **`triggeredByReset` guard** detects the `issue-reset` trigger
- **`emitResetIssue`** reopens the issue (CLOSED→OPEN), sets projectStatus to "Backlog", clears iteration/failures/assignees
- Sub-issues are also reset: reopened (CLOSED→OPEN) and set to projectStatus="Ready"
- Completed todos are NOT reset — they remain checked
- History entries from prior iterations persist in the fixture but are not asserted

## State Transitions

### Step 1: 01-detecting → 02-resetting
**Input state:** trigger="issue-reset", issue.state="CLOSED", projectStatus="Done", iteration=5, failures=0, todos=3/3 completed, 3 sub-issues all CLOSED/Done, history=["Iteration 1: Implementation","Iteration 2: CI fix","Iteration 3: Review feedback"]
**Transition:** Guard `triggeredByReset` matches. Routes to `resetting` state. Runs `emitResetIssue` on parent and all sub-issues.
**Output state:** issue.state="OPEN", projectStatus="Backlog", iteration=0, failures=0, assignees=[], all sub-issues reopened with projectStatus="Ready", todos still 3/3 completed
**Why:** The reset reopens everything so the issue can be re-worked from scratch. Sub-issues get "Ready" status (not "Backlog") because they already have content. Iteration resets to 0 unlike `issue-reset` which preserves it — test-cleanup is a full clean slate. Completed todos remain checked because the work was already done.

## Expected Iteration History

No iteration history entries are asserted in this scenario.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | detecting | `["Iteration 1: Implementation", "Iteration 2: CI fix", "Iteration 3: Review feedback"]` | Pre-existing from prior work |
| 02 | resetting | _(not asserted)_ | — |

**Note:** The existing history from prior iterations is present in the input state but the fixture doesn't assert on history in the output state.

## Expected Final State

- **issue.state:** OPEN (reopened from CLOSED)
- **projectStatus:** Backlog (reset from Done)
- **iteration:** 0 (fully reset)
- **failures:** 0
- **assignees:** [] (bot unassigned)
- **sub-issues:** All 3 reopened, projectStatus="Ready"
- **todos:** 3/3 completed (NOT reset — work was already done)

## Common Failure Modes

- **Issue still CLOSED:** The reset must reopen the issue. If state is still "CLOSED", `emitResetIssue` didn't change the issue state.
- **Sub-issues not reopened:** Each sub-issue must be individually reopened and have its status set to "Ready".
- **iteration not reset to 0:** Unlike `issue-reset`, test-cleanup resets iteration to 0 for a full clean slate.
- **Todos unchecked:** The reset should NOT uncheck completed todos. If todos went from 3/3 to 0/3, the reset incorrectly cleared todo state.
- **projectStatus != "Backlog":** The parent must be set to "Backlog". Sub-issues must be set to "Ready".
