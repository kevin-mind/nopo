# research

## What This Tests

Tests the new discussion flow: when a discussion is created, Claude spawns research threads to investigate the topic. This is the entry point for the discussion automation system.

## State Machine Context

Discussion research is triggered by new discussion creation. Key mechanics:

- **`triggeredByDiscussionCreated` guard** detects the `discussion_created` trigger
- **`emitRunClaudeResearch`** runs Claude to analyze the discussion topic and spawn research threads
- Claude creates 3-7 threaded comments, each investigating a different aspect of the topic
- The discussion category is "q-a" (question and answer)
- Unlike issue automation, discussions don't have project fields, iteration counters, or CI

## State Transitions

### Step 1: 01-researching (terminal)
**Input state:** trigger="discussion_created", discussion.title="How does the build system work?", body contains questions about Docker images, Buildx Bake, and caching
**Transition:** Guard `triggeredByDiscussionCreated` matches. Runs `emitRunClaudeResearch` with mock "discussion-research/basic". Claude spawns research threads.
**Output state:** At least 1 comment posted (research threads spawned)
**Why:** The research agent analyzes the discussion body, identifies key questions, and creates threaded comments for each research area. Each thread will be independently investigated.

## Expected Iteration History

Not applicable to discussions. Discussions don't have iteration history.

## Expected Final State

- **expected.minComments:** 1 (at least one research thread spawned)

## Common Failure Modes

- **No comments posted:** If minComments assertion fails, the research mock didn't produce output or the comment-posting action failed.
- **Wrong trigger detected:** If the machine routes to responding instead of researching, the trigger detection is wrong (should be `discussion_created`, not `discussion_comment`).
- **Too few research threads:** The research agent should spawn multiple threads. If only 1, the mock may not be producing enough research areas.
