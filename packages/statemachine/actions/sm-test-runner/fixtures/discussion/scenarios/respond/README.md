# respond

## What This Tests

Tests the discussion comment response flow: when a human comments on a discussion, Claude responds in the thread with relevant information.

## State Machine Context

Discussion comment responses are triggered by human comments. Key mechanics:

- **`triggeredByDiscussionComment` guard** detects the `discussion_comment` trigger
- **Bot comment detection** prevents infinite loops — if the comment author is the bot, the machine skips
- **`emitRunClaudeRespond`** runs Claude with the comment context and discussion history
- Claude responds in the same thread as the human's comment
- The response is contextual — it considers the full discussion and the specific question asked

## State Transitions

### Step 1: 01-responding (terminal)
**Input state:** trigger="discussion_comment", discussion.title="Best practices for error handling", commentBody="Can you explain specifically how API errors should be structured?", commentAuthor="test-user"
**Transition:** Guard `triggeredByDiscussionComment` matches. Author is "test-user" (not bot) so it proceeds. Runs `emitRunClaudeRespond` with mock "discussion-respond/api-errors".
**Output state:** At least 2 comments posted (the response + potentially follow-up context)
**Why:** Claude analyzes the specific question about API error structuring and responds with relevant information from the codebase and best practices.

## Expected Iteration History

Not applicable to discussions.

## Expected Final State

- **expected.minComments:** 2

## Common Failure Modes

- **Bot loop:** If the comment author were the bot itself, the machine should skip to prevent infinite response loops. If it doesn't skip bot comments, a loop could occur.
- **No response posted:** If the comment action didn't fire, the trigger detection may have failed or the mock wasn't found.
- **Response in wrong thread:** The response should be in the same thread as the human's comment, not as a top-level discussion comment.
