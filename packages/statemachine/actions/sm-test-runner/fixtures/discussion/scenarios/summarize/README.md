# summarize

## What This Tests

Tests the /summarize command on a discussion: Claude generates a comprehensive summary and updates the discussion description with a "## Summary" section.

## State Machine Context

The /summarize command creates a living summary of the discussion. Key mechanics:

- **`triggeredByDiscussionCommand` guard** detects the `discussion_command` trigger with command="/summarize"
- **`emitRunClaudeSummarize`** runs Claude to analyze all comments and generate a summary
- The summary is inserted into the discussion's body/description (not just as a comment)
- The discussion category is "ideas"
- Comments are also posted with the summary content

## State Transitions

### Step 1: 01-summarizing (terminal)
**Input state:** trigger="discussion_command", command="/summarize", discussion.title="Database migration strategy", body describes migration topics (zero-downtime, rollback, testing)
**Transition:** Guard `triggeredByDiscussionCommand` matches with command="/summarize". Runs `emitRunClaudeSummarize` with mock "discussion-summarize/basic".
**Output state:** At least 2 comments posted, discussion body updated to contain "## Summary" section
**Why:** The summarize agent reads all discussion content, synthesizes key points, decisions, and open questions, then updates the discussion description with a structured summary section. This creates a "living document" that always reflects the current state of the discussion.

## Expected Iteration History

Not applicable to discussions.

## Expected Final State

- **expected.minComments:** 2
- **expected.bodyContains:** ["## Summary"] (the discussion body must contain a Summary heading)

## Common Failure Modes

- **Missing "## Summary" in body:** The summarize action must update the discussion description. If the body doesn't contain "## Summary", the body update failed.
- **Summary only in comment:** The summary should be in the discussion body (description), not only as a comment. If it's only a comment, the body-update action didn't fire.
- **Wrong command detected:** If routed to /plan or /complete instead, the command parsing is wrong.
- **No comments posted:** Summary should also be posted as a comment for notification purposes.
