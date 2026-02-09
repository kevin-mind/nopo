# plan

## What This Tests

Tests the /plan command on a discussion: Claude analyzes the discussion content and creates GitHub issues for actionable items, turning research/discussion into tracked work.

## State Machine Context

The /plan command bridges discussions and issues. Key mechanics:

- **`triggeredByDiscussionCommand` guard** detects the `discussion_command` trigger with command="/plan"
- **`emitRunClaudePlan`** runs Claude to analyze the discussion and generate issue specifications
- Claude creates issues with appropriate labels, including the "test:automation" label for tracking
- The discussion category is "ideas" (proposals that may become implementation work)
- A comment is posted summarizing what issues were created

## State Transitions

### Step 1: 01-planning (terminal)
**Input state:** trigger="discussion_command", command="/plan", discussion.title="Implement caching layer", body describes proposed changes (Redis, query caching, cache invalidation)
**Transition:** Guard `triggeredByDiscussionCommand` matches with command="/plan". Runs `emitRunClaudePlan` with mock "discussion-plan/basic". Claude creates issues from the discussion.
**Output state:** At least 2 comments posted, at least 1 issue created with "test:automation" label
**Why:** The plan agent analyzes the discussion's proposed changes and creates structured issues for each actionable item. The "test:automation" label marks issues as created by automation for tracking.

## Expected Iteration History

Not applicable to discussions.

## Expected Final State

- **expected.minComments:** 2 (summary comment + potential detail comments)
- **expected.createdIssues.minCount:** 1 (at least one issue created)
- **expected.createdIssues.requiredLabels:** ["test:automation"]

## Common Failure Modes

- **No issues created:** If the plan mock didn't produce issue specs or the issue creation action failed.
- **Missing "test:automation" label:** Created issues must have this label for tracking. If missing, the label wasn't included in the issue creation.
- **Wrong command detected:** If the machine routes to /summarize or /complete instead of /plan, the command parsing is wrong.
- **No summary comment:** A comment should be posted listing the created issues.
