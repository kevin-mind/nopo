# issue-comment

## What This Tests

Tests the @claude mention flow: when a user comments on an issue mentioning @claude, the bot responds to the comment. The issue state is unchanged — this is a side-channel interaction.

## State Machine Context

Issue comments with @claude trigger the `commenting` state. Key mechanics:

- **`triggeredByComment` guard** detects the `issue-comment` trigger
- **`emitRunClaudeComment`** runs Claude with the comment context, producing a reply
- The comment flow is stateless with respect to project fields — it doesn't change iteration, failures, status, or todos
- After responding, the machine transitions to `done` (a final state for this invocation)

## State Transitions

### Step 1: 01-commenting → 02-done
**Input state:** trigger="issue-comment", projectStatus="In progress", iteration=2, comment.body="@claude Can you explain the error handling approach you're using?", comment.author="test-user"
**Transition:** Guard `triggeredByComment` matches. Enters `commenting` state, runs `emitRunClaudeComment` with the comment context.
**Output state:** No changes to issue fields. Claude has posted a reply comment.
**Why:** The comment handler is fire-and-forget — it reads the comment, generates a response, and posts it. No project fields are modified because this is an informational interaction, not a workflow transition.

## Expected Iteration History

No iteration history entries are expected. Comment responses don't modify the iteration history.

| Step | State | Expected `history` | Action |
|------|-------|--------------------|--------|
| 01 | commenting | _(empty)_ | — |
| 02 | done | _(empty)_ | — |

## Expected Final State

- **projectStatus:** In progress (unchanged)
- **iteration:** 2 (unchanged)
- **failures:** 0 (unchanged)
- **todos:** 3 total, 0 completed (unchanged)
- **expected.finalState:** commenting

## Common Failure Modes

- **Issue fields modified:** The comment handler should NOT change projectStatus, iteration, failures, or todos. If any changed, the wrong state path was taken.
- **No reply posted:** If `emitRunClaudeComment` didn't fire, the trigger detection may have failed or the comment mock wasn't found.
- **Wrong trigger detected:** If the machine routes to `iterating` instead of `commenting`, the trigger priority logic may be wrong (comment trigger should take precedence in certain contexts).
