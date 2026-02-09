# complete

## What This Tests

Tests the /complete command on a discussion: marks the discussion as complete, posts a conclusion comment, and adds a rocket reaction to signal completion.

## State Machine Context

The /complete command is the terminal action for discussions. Key mechanics:

- **`triggeredByDiscussionCommand` guard** detects the `discussion_command` trigger with command="/complete"
- The action posts a closing comment summarizing the discussion outcome
- A rocket reaction (🚀) is added to the command comment to visually signal completion
- The discussion category is "q-a"
- After completion, the discussion automation stops responding to new comments

## State Transitions

### Step 1: 01-completing (terminal)
**Input state:** trigger="discussion_command", command="/complete", discussion.title="Completed research topic", body="This discussion has reached its conclusion. Resolution: We decided to go with approach A."
**Transition:** Guard `triggeredByDiscussionCommand` matches with command="/complete". Posts closing comment and adds reaction.
**Output state:** At least 2 comments posted, rocket reaction added
**Why:** The complete command signals that the discussion has reached its conclusion. The rocket reaction provides a visual indicator. The closing comment summarizes the resolution for future reference.

## Expected Iteration History

Not applicable to discussions.

## Expected Final State

- **expected.minComments:** 2 (closing comment + summary)
- **expected.hasReaction:** "ROCKET" (🚀 reaction added to signal completion)

## Common Failure Modes

- **Missing rocket reaction:** The ROCKET reaction must be added to the command comment. If absent, the reaction action failed.
- **No closing comment:** A comment should be posted summarizing the discussion conclusion.
- **Wrong command detected:** If routed to /summarize or /plan instead, the command parsing is wrong.
- **Discussion still active:** After /complete, the discussion automation should stop responding. If it continues, the completion state isn't being tracked.
