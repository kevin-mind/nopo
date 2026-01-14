import { expressions, NormalJob, Step, Workflow } from "@github-actions-workflow-ts/lib";

import { claudeActionStep } from "./lib/claude-action.js";
import { discussionPermissions } from "./lib/patterns.js";
import { checkoutStep } from "./lib/steps.js";

// =============================================================================
// PROMPTS
// =============================================================================

const SUMMARIZE_PROMPT = `You are summarizing Discussion #${expressions.expn("github.event.client_payload.discussion_number")}.

Fetch the full discussion content, analyze all comments, and organize into Key Findings, Questions Answered, Open Items, and Next Steps.

## IMPORTANT: Write Summary to File

After completing your analysis, you MUST write your summary to /tmp/discussion-summary.md:
\`\`\`bash
cat > /tmp/discussion-summary.md << 'SUMMARY_EOF'
## 📋 Discussion Summary

<your organized summary with Key Findings, Questions Answered, Open Items, Next Steps>
SUMMARY_EOF
\`\`\`

## IMPORTANT: Update Discussion Description

You MUST also update the discussion description to be a comprehensive summary of all knowledge.
Read the current description from /tmp/discussion-original-body.txt, then write an updated version to /tmp/discussion-updated-body.md.

Since this is a /summarize command, the description should be a complete, authoritative summary:
1. Preserve the original user content at the top
2. Create a comprehensive "## Current State" section that synthesizes ALL findings from the discussion

Structure (include all sections that have content):
\`\`\`markdown
<original user content>

---

## Current State

### Summary
- High-level summary of what was discovered/decided

### Key Findings
- All validated facts and discoveries from the discussion

### Answered Questions
- **Q: Question?** A: Answer
- (all Q&A pairs from the discussion)

### Data & Tables
- [Table description](link to comment) - What the data shows

### Decisions
- Decisions made with rationale

### Code References
- \`path/file.ts:123\` - What this does

### Related Resources
- Links to created issues, PRs, external docs

### Open Questions
- Any remaining unanswered questions

### Next Steps
- Recommended actions (e.g., "Use /plan to create issues")
\`\`\`

Write this to /tmp/discussion-updated-body.md`;

const RESPOND_PROMPT = `You are investigating a research thread or answering a question on Discussion #${expressions.expn("github.event.client_payload.discussion_number")}.

**Comment to respond to:** ${expressions.expn("github.event.client_payload.comment_body")}
**Author:** @${expressions.expn("github.event.client_payload.comment_author")}

## Your Task

Research thoroughly but respond CONCISELY:
1. Search the codebase (grep, glob, read) to find relevant code
2. Search GitHub (\`gh issue list\`, \`gh pr list\`) for related discussions
3. Check documentation (decisions/, AGENTS.md, README.md)
4. Web search if helpful for understanding external concepts

## Response Format (CRITICAL)

Your response MUST be:
- **Under 1000 words** - be concise and focused
- **Structured with headers** - easy to scan
- **Heavy on visuals** - diagrams, tables, lists over paragraphs

Response structure:
\`\`\`markdown
## Context Summary
> 1-2 sentence summary of what was investigated

## Findings

### <Finding 1>
- Bullet points, not paragraphs
- Code references: \`path/file.ts:42\`

### <Finding 2>
| Column 1 | Column 2 |
|----------|----------|
| Data     | Data     |

## Code References
- \`src/module/file.ts:123\` - Brief description
- \`src/other/file.ts:456\` - Brief description

## Diagram (if applicable)
\`\`\`mermaid
graph LR
  A[Component] --> B[Component]
\`\`\`

## Next Steps
- Actionable recommendation 1
- Actionable recommendation 2
\`\`\`

If they're asking for implementation: "Use \`/plan\` to create issues"

## IMPORTANT: Write Response to File

Write your response to /tmp/discussion-response.md

## IMPORTANT: Update Discussion Description

Read current description from /tmp/discussion-original-body.txt,
write updated version to /tmp/discussion-updated-body.md.

When updating:
1. Preserve original user content (everything before \`---\`)
2. Update "## Current State" section

Add findings to appropriate sections:
- **Key Findings**: Validated discoveries
- **Answered Questions**: \`**Q:** Question? **A:** Answer\`
- **Data & Tables**: Link to comment with table
- **Code References**: \`path/file.ts:123\` - Description
- **Open Questions**: Remaining questions`;

const RESEARCH_PROMPT = `A new discussion was created: **${expressions.expn("github.event.client_payload.discussion_title")}**

**Discussion body:**
${expressions.expn("github.event.client_payload.discussion_body")}

## Your Task

Your goal is to IDENTIFY research questions, NOT to answer them. You are spawning research threads
that will be investigated by separate agents.

1. Read the discussion topic to understand what needs to be researched
2. Identify 3-7 distinct research questions or investigation areas
3. Create a SEPARATE FILE for each research thread

DO NOT do any research yourself. Just identify the questions and create the thread files.

## CRITICAL: Create Separate Files for Each Thread

You MUST create multiple files, one per research topic. Use this exact bash pattern:

\`\`\`bash
cat > /tmp/research-thread-1.md << 'THREAD_EOF'
## 🔍 Research: Current Architecture

**Question:** How does the existing system work?

**Investigation Areas:**
- Search for main entry points
- Identify core modules and their relationships
- Find configuration files

**Expected Deliverables:**
- Architecture diagram
- Key file paths
- Component descriptions
THREAD_EOF
\`\`\`

\`\`\`bash
cat > /tmp/research-thread-2.md << 'THREAD_EOF'
## 🔍 Research: Related Issues & PRs

**Question:** What prior work or discussions exist on this topic?

**Investigation Areas:**
- Search GitHub issues for related keywords
- Check closed PRs for prior implementations
- Look for relevant discussions

**Expected Deliverables:**
- List of related issues/PRs
- Summary of prior decisions
THREAD_EOF
\`\`\`

\`\`\`bash
cat > /tmp/research-thread-3.md << 'THREAD_EOF'
## 🔍 Research: Implementation Approaches

**Question:** What are the possible ways to implement this?

**Investigation Areas:**
- Analyze existing patterns in codebase
- Consider different architectural approaches
- Evaluate trade-offs

**Expected Deliverables:**
- 2-3 implementation options
- Pros/cons for each
THREAD_EOF
\`\`\`

Create 3-7 thread files based on the discussion topic. Each file will become a separate comment
that triggers an independent investigation agent.

## ALSO: Update Discussion Description

Read the original description from /tmp/discussion-original-body.txt and write an updated
version to /tmp/discussion-updated-body.md that lists the research threads being spawned:

\`\`\`bash
cat > /tmp/discussion-updated-body.md << 'DESC_EOF'
<paste original content here>

---

## Current State

### Research Threads
- 🔍 **Current Architecture** - How does the existing system work?
- 🔍 **Related Issues & PRs** - What prior work exists?
- 🔍 **Implementation Approaches** - What are the options?

### Open Questions
- List main questions being investigated
DESC_EOF
\`\`\``;

const PLAN_PROMPT = `A user requested a plan for Discussion #${expressions.expn("github.event.client_payload.discussion_number")}.

## Your Task

1. Fetch the full discussion content using gh api graphql

2. Search the codebase to understand current architecture and identify where changes are needed

3. Extract actionable items and create GitHub issues for each:
\`\`\`bash
gh issue create \\
  --title "Your Issue Title" \\
  --body "Related to discussion: #${expressions.expn("github.event.client_payload.discussion_number")}

## Context
[Context from discussion]

## Tasks
- [ ] Task 1
- [ ] Task 2" \\
  --label "discussion:${expressions.expn("github.event.client_payload.discussion_number")}"
\`\`\`

## IMPORTANT: Write Summary to File

After creating issues, you MUST write a summary to /tmp/discussion-plan-summary.md:
\`\`\`bash
cat > /tmp/discussion-plan-summary.md << 'PLAN_EOF'
## 📋 Created Issues

- #123 - Issue title here
- #124 - Another issue title

Assign nopo-bot to any of these issues to have me implement them.
PLAN_EOF
\`\`\`

## IMPORTANT: Update Discussion Description

You MUST also update the discussion description to reflect the plan and created issues.
Read the current description from /tmp/discussion-original-body.txt, then write an updated version to /tmp/discussion-updated-body.md.

Since this is a /plan command, update the description to include the implementation plan:
1. Preserve the original user content at the top
2. Update the "## Current State" section to include the plan

Add a "### Implementation Plan" section with links to the created issues:
\`\`\`markdown
<original user content>

---

## Current State

### Summary
- Summary of the discussion findings

### Implementation Plan
The following issues have been created to implement this:
- #123 - Issue title (status)
- #124 - Another issue

### Key Findings
- Relevant findings that informed the plan

### Decisions
- Architectural decisions made

### Code References
- \`path/file.ts:123\` - Relevant code

### Open Questions
- Any remaining questions
\`\`\`

Write this to /tmp/discussion-updated-body.md`;

// =============================================================================
// GRAPHQL QUERIES
// =============================================================================

const GET_DISCUSSION_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      id
      body
    }
  }
}`;

const ADD_REACTION_MUTATION = `mutation($subjectId: ID!) {
  addReaction(input: {
    subjectId: $subjectId
    content: EYES
  }) {
    reaction { id }
  }
}`;

const ADD_DISCUSSION_COMMENT_MUTATION = `mutation($discussionId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId
    body: $body
  }) {
    comment { id }
  }
}`;

const ADD_THREADED_COMMENT_MUTATION = `mutation($discussionId: ID!, $replyToId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId
    replyToId: $replyToId
    body: $body
  }) {
    comment { id }
  }
}`;

const GET_COMMENT_PARENT_QUERY = `query($commentId: ID!) {
  node(id: $commentId) {
    ... on DiscussionComment {
      id
      replyTo {
        id
        replyTo {
          id
        }
      }
    }
  }
}`;

const UPDATE_DISCUSSION_BODY_MUTATION = `mutation($discussionId: ID!, $body: String!) {
  updateDiscussion(input: {
    discussionId: $discussionId
    body: $body
  }) {
    discussion { id }
  }
}`;

// =============================================================================
// SHELL SCRIPTS
// =============================================================================

const GET_DISCUSSION_ID_SCRIPT = `discussion_data=$(gh api graphql -f query='
  ${GET_DISCUSSION_QUERY}
' -f owner="\${GITHUB_REPOSITORY%/*}" -f repo="\${GITHUB_REPOSITORY#*/}" -F number="$DISCUSSION_NUMBER")

discussion_id=$(echo "$discussion_data" | jq -r '.data.repository.discussion.id')
echo "discussion_id=$discussion_id" >> $GITHUB_OUTPUT

# Store body in a file to handle multiline content safely
echo "$discussion_data" | jq -r '.data.repository.discussion.body' > /tmp/discussion-original-body.txt`;

const ADD_EYES_REACTION_SCRIPT = `gh api graphql -f query='
  ${ADD_REACTION_MUTATION}
' -f subjectId="$COMMENT_ID"`;

const POST_SUMMARY_COMMENT_SCRIPT = `if [[ ! -f /tmp/discussion-summary.md ]]; then
  echo "No summary file found"
  exit 1
fi

gh api graphql -f query='
  ${ADD_DISCUSSION_COMMENT_MUTATION}
' -f discussionId="$DISCUSSION_ID" -F body=@/tmp/discussion-summary.md`;

const FIND_THREAD_ROOT_SCRIPT = `# Query the comment to see if it has a parent (replyTo)
comment_data=$(gh api graphql -f query='
  ${GET_COMMENT_PARENT_QUERY}
' -f commentId="$COMMENT_ID")

# Extract the root comment ID (walk up the replyTo chain)
root_id=$(echo "$comment_data" | jq -r '
  .data.node
  | if .replyTo.replyTo.id then .replyTo.replyTo.id
    elif .replyTo.id then .replyTo.id
    else .id
    end
')

echo "Original comment: $COMMENT_ID"
echo "Root comment: $root_id"
echo "root_comment_id=$root_id" >> $GITHUB_OUTPUT`;

const POST_THREADED_RESPONSE_SCRIPT = `if [[ ! -f /tmp/discussion-response.md ]]; then
  echo "No response file found"
  exit 1
fi

gh api graphql -f query='
  ${ADD_THREADED_COMMENT_MUTATION}
' -f discussionId="$DISCUSSION_ID" -f replyToId="$REPLY_TO_ID" -F body=@/tmp/discussion-response.md`;

const ADD_SUCCESS_REACTION_SCRIPT = `gh api graphql -f query='
  mutation($subjectId: ID!) {
    addReaction(input: {
      subjectId: $subjectId
      content: THUMBS_UP
    }) {
      reaction { id }
    }
  }
' -f subjectId="$COMMENT_ID"`;

const HANDLE_RESPOND_FAILURE_SCRIPT = `# Add thumbs down to the original comment
gh api graphql -f query='
  mutation($subjectId: ID!) {
    addReaction(input: {
      subjectId: $subjectId
      content: THUMBS_DOWN
    }) {
      reaction { id }
    }
  }
' -f subjectId="$COMMENT_ID" || true

# Post error as reply to the root comment in the thread
gh api graphql -f query='
  ${ADD_THREADED_COMMENT_MUTATION}
' -f discussionId="$DISCUSSION_ID" -f replyToId="\${ROOT_COMMENT_ID:-$COMMENT_ID}" -f body="⚠️ **Failed to process your question**

See [workflow run]($RUN_URL) for details."`;

const DEBUG_LIST_FILES_SCRIPT = `echo "=== Files in /tmp ==="
ls -la /tmp/research-thread-*.md 2>/dev/null || echo "No research-thread files found"
ls -la /tmp/discussion-*.md 2>/dev/null || echo "No discussion files found"
echo ""
echo "=== Content of research thread files ==="
for file in /tmp/research-thread-*.md; do
  if [[ -f "$file" ]]; then
    echo "--- $file ---"
    head -20 "$file"
    echo ""
  fi
done`;

const POST_RESEARCH_THREADS_SCRIPT = `# Check if files exist
if ! ls /tmp/research-thread-*.md 1> /dev/null 2>&1; then
  echo "ERROR: No research thread files found!"
  echo "The Claude agent should have created files like /tmp/research-thread-1.md"
  exit 1
fi

# Count files
file_count=$(ls /tmp/research-thread-*.md 2>/dev/null | wc -l)
echo "Found $file_count research thread files"

# Post each research thread and collect comment IDs
comment_ids=""
comment_bodies=""

for file in /tmp/research-thread-*.md; do
  if [[ -f "$file" ]]; then
    echo "Posting research thread: $file"

    # Post comment and capture the comment ID
    comment_result=$(gh api graphql -f query='
      ${ADD_DISCUSSION_COMMENT_MUTATION}
    ' -f discussionId="$DISCUSSION_ID" -F body=@"$file")

    comment_id=$(echo "$comment_result" | jq -r '.data.addDiscussionComment.comment.id')
    echo "Posted comment: $comment_id"

    # Store comment data for dispatch step
    # Use base64 to safely encode the body
    encoded_body=$(cat "$file" | base64 -w 0)
    echo "\${comment_id}:\${encoded_body}" >> /tmp/posted_comments.txt

    # Small delay between posts
    sleep 2
  fi
done

echo "Successfully posted $file_count research threads"
echo "Comments posted with PAT - webhooks will trigger dispatcher automatically"`;

const POST_PLAN_COMMENT_SCRIPT = `if [[ ! -f /tmp/discussion-plan-summary.md ]]; then
  echo "No plan summary file found"
  exit 1
fi

gh api graphql -f query='
  ${ADD_THREADED_COMMENT_MUTATION}
' -f discussionId="$DISCUSSION_ID" -f replyToId="$REPLY_TO_ID" -F body=@/tmp/discussion-plan-summary.md`;

const ADD_ROCKET_REACTION_SCRIPT = `gh api graphql -f query='
  mutation($subjectId: ID!) {
    addReaction(input: {
      subjectId: $subjectId
      content: ROCKET
    }) {
      reaction { id }
    }
  }
' -f subjectId="$COMMENT_ID"`;

const POST_COMPLETION_MESSAGE_SCRIPT = `gh api graphql -f query='
  ${ADD_DISCUSSION_COMMENT_MUTATION}
' -f discussionId="$DISCUSSION_ID" -f body="✅ **This discussion thread has been marked as complete.**

If you have additional questions, feel free to post a new comment!"`;

const UPDATE_DESCRIPTION_SCRIPT = `# Find any updated body file
if [[ -d /tmp/updated-bodies ]]; then
  updated_file=$(find /tmp/updated-bodies -name "*.md" -type f | head -1)
fi

if [[ -z "$updated_file" || ! -f "$updated_file" ]]; then
  echo "No updated body file found, skipping description update"
  exit 0
fi

echo "Found updated body: $updated_file"

gh api graphql -f query='
  ${UPDATE_DISCUSSION_BODY_MUTATION}
' -f discussionId="$DISCUSSION_ID" -F body=@"$updated_file"

echo "✅ Discussion description updated"`;

// =============================================================================
// SHARED STEPS
// =============================================================================

const downloadOriginalBodyStep = new Step({
  name: "Download original body",
  uses: "actions/download-artifact@v4",
  with: {
    name: "discussion-original-body",
    path: "/tmp",
  },
});

const uploadUpdatedBodyStep = (suffix: string) =>
  new Step({
    name: "Upload updated body",
    if: "always()",
    uses: "actions/upload-artifact@v4",
    with: {
      name: `discussion-updated-body-${suffix}`,
      path: "/tmp/discussion-updated-body.md",
      "if-no-files-found": "ignore",
    },
  });

// =============================================================================
// JOBS
// =============================================================================

const prepareJob = new NormalJob("prepare", {
  "runs-on": "ubuntu-latest",
  permissions: {
    contents: "read",
    discussions: "write",
    "id-token": "write",
  },
  outputs: {
    discussion_id: expressions.expn("steps.get_id.outputs.discussion_id"),
    discussion_body: expressions.expn("steps.get_id.outputs.discussion_body"),
    action_type: expressions.expn("github.event.client_payload.action_type"),
  },
}).addSteps([
  new Step({
    name: "Get discussion ID and body",
    id: "get_id",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      DISCUSSION_NUMBER: expressions.expn("github.event.client_payload.discussion_number"),
    },
    run: GET_DISCUSSION_ID_SCRIPT,
  }),
  new Step({
    name: "Upload original body",
    uses: "actions/upload-artifact@v4",
    with: {
      name: "discussion-original-body",
      path: "/tmp/discussion-original-body.txt",
      "retention-days": 1,
    },
  }),
  new Step({
    name: "Add eyes reaction if responding",
    if: "github.event.client_payload.action_type == 'respond'",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      COMMENT_ID: expressions.expn("github.event.client_payload.comment_id"),
    },
    run: ADD_EYES_REACTION_SCRIPT,
  }),
]);

const summarizeJob = new NormalJob("summarize", {
  needs: ["prepare"],
  if: "github.event.client_payload.action_type == 'summarize'",
  "runs-on": "ubuntu-latest",
  permissions: {
    contents: "read",
    discussions: "write",
    "id-token": "write",
  },
}).addSteps([
  checkoutStep,
  downloadOriginalBodyStep,
  claudeActionStep({
    id: "claude",
    prompt: SUMMARIZE_PROMPT,
    maxTurns: 50,
    settings: ".claude/settings.json",
    showFullOutput: true,
    secretsTokenName: "CLAUDE_CODE_OAUTH_TOKEN",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
    },
  }),
  new Step({
    name: "Post summary comment",
    if: "always()",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      DISCUSSION_ID: expressions.expn("needs.prepare.outputs.discussion_id"),
    },
    run: POST_SUMMARY_COMMENT_SCRIPT,
  }),
  uploadUpdatedBodyStep("summarize"),
]);

const respondJob = new NormalJob("respond", {
  needs: ["prepare"],
  if: "github.event.client_payload.action_type == 'respond'",
  "runs-on": "ubuntu-latest",
  permissions: {
    contents: "read",
    discussions: "write",
    "id-token": "write",
  },
}).addSteps([
  checkoutStep,
  downloadOriginalBodyStep,
  claudeActionStep({
    id: "claude",
    prompt: RESPOND_PROMPT,
    maxTurns: 100,
    settings: ".claude/settings.json",
    showFullOutput: true,
    secretsTokenName: "CLAUDE_CODE_OAUTH_TOKEN",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
    },
  }),
  new Step({
    name: "Find thread root comment",
    id: "find_root",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      DISCUSSION_ID: expressions.expn("needs.prepare.outputs.discussion_id"),
      COMMENT_ID: expressions.expn("github.event.client_payload.comment_id"),
    },
    run: FIND_THREAD_ROOT_SCRIPT,
  }),
  new Step({
    name: "Post response comment",
    if: "always()",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      DISCUSSION_ID: expressions.expn("needs.prepare.outputs.discussion_id"),
      REPLY_TO_ID: expressions.expn("steps.find_root.outputs.root_comment_id"),
    },
    run: POST_THREADED_RESPONSE_SCRIPT,
  }),
  uploadUpdatedBodyStep("respond"),
  new Step({
    name: "Add success reaction",
    if: "success()",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      COMMENT_ID: expressions.expn("github.event.client_payload.comment_id"),
    },
    run: ADD_SUCCESS_REACTION_SCRIPT,
  }),
  new Step({
    name: "Handle failure",
    if: "failure()",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      DISCUSSION_ID: expressions.expn("needs.prepare.outputs.discussion_id"),
      COMMENT_ID: expressions.expn("github.event.client_payload.comment_id"),
      ROOT_COMMENT_ID: expressions.expn("steps.find_root.outputs.root_comment_id"),
      RUN_URL:
        `${expressions.expn("github.server_url")}/${expressions.expn("github.repository")}/actions/runs/${expressions.expn("github.run_id")}`,
    },
    run: HANDLE_RESPOND_FAILURE_SCRIPT,
  }),
]);

const researchJob = new NormalJob("research", {
  needs: ["prepare"],
  if: "github.event.client_payload.action_type == 'research'",
  "runs-on": "ubuntu-latest",
  permissions: {
    contents: "read",
    discussions: "write",
    "id-token": "write",
  },
}).addSteps([
  checkoutStep,
  downloadOriginalBodyStep,
  claudeActionStep({
    id: "claude",
    prompt: RESEARCH_PROMPT,
    maxTurns: 30,
    settings: ".claude/settings.json",
    showFullOutput: true,
    secretsTokenName: "CLAUDE_CODE_OAUTH_TOKEN",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
    },
  }),
  new Step({
    name: "Debug - List created files",
    if: "always()",
    run: DEBUG_LIST_FILES_SCRIPT,
  }),
  new Step({
    name: "Post research thread comments",
    id: "post_threads",
    if: "always()",
    env: {
      // Use PAT to post comments so GitHub fires webhooks
      // (GITHUB_TOKEN comments don't trigger discussion_comment events)
      GH_TOKEN: expressions.secret("PAT_TOKEN"),
      DISCUSSION_ID: expressions.expn("needs.prepare.outputs.discussion_id"),
    },
    run: POST_RESEARCH_THREADS_SCRIPT,
  }),
  uploadUpdatedBodyStep("research"),
]);

const planJob = new NormalJob("plan", {
  needs: ["prepare"],
  if: "github.event.client_payload.action_type == 'plan'",
  "runs-on": "ubuntu-latest",
  permissions: {
    contents: "read",
    discussions: "write",
    issues: "write",
    "id-token": "write",
  },
}).addSteps([
  checkoutStep,
  downloadOriginalBodyStep,
  claudeActionStep({
    id: "claude",
    prompt: PLAN_PROMPT,
    maxTurns: 100,
    settings: ".claude/settings.json",
    showFullOutput: true,
    secretsTokenName: "CLAUDE_CODE_OAUTH_TOKEN",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
    },
  }),
  new Step({
    name: "Find thread root comment",
    id: "find_root",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      COMMENT_ID: expressions.expn("github.event.client_payload.comment_id"),
    },
    run: FIND_THREAD_ROOT_SCRIPT,
  }),
  new Step({
    name: "Post plan summary comment",
    if: "always()",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      DISCUSSION_ID: expressions.expn("needs.prepare.outputs.discussion_id"),
      REPLY_TO_ID: expressions.expn("steps.find_root.outputs.root_comment_id"),
    },
    run: POST_PLAN_COMMENT_SCRIPT,
  }),
  uploadUpdatedBodyStep("plan"),
]);

const completeJob = new NormalJob("complete", {
  needs: ["prepare"],
  if: "github.event.client_payload.action_type == 'complete'",
  "runs-on": "ubuntu-latest",
  permissions: {
    contents: "read",
    discussions: "write",
    "id-token": "write",
  },
}).addSteps([
  new Step({
    name: "Add rocket reaction",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      COMMENT_ID: expressions.expn("github.event.client_payload.comment_id"),
    },
    run: ADD_ROCKET_REACTION_SCRIPT,
  }),
  new Step({
    name: "Post completion message",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      DISCUSSION_ID: expressions.expn("needs.prepare.outputs.discussion_id"),
    },
    run: POST_COMPLETION_MESSAGE_SCRIPT,
  }),
]);

const updateDescriptionJob = new NormalJob("update-description", {
  needs: ["prepare", "summarize", "respond", "research", "plan"],
  if: "always() && !cancelled()",
  "runs-on": "ubuntu-latest",
  permissions: {
    discussions: "write",
  },
}).addSteps([
  new Step({
    name: "Download updated body (try all sources)",
    uses: "actions/download-artifact@v4",
    with: {
      pattern: "discussion-updated-body-*",
      "merge-multiple": true,
      path: "/tmp/updated-bodies",
    },
    "continue-on-error": true,
  }),
  new Step({
    name: "Find and apply updated body",
    env: {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      DISCUSSION_ID: expressions.expn("needs.prepare.outputs.discussion_id"),
    },
    run: UPDATE_DESCRIPTION_SCRIPT,
  }),
]);

// =============================================================================
// WORKFLOW
// =============================================================================

const workflow = new Workflow("discussion-handler", {
  name: "Discussion Handler",
  on: {
    repository_dispatch: {
      types: ["discussion_event"],
    },
  },
  permissions: discussionPermissions,
});

workflow.addJobs([
  prepareJob,
  summarizeJob,
  respondJob,
  researchJob,
  planJob,
  completeJob,
  updateDescriptionJob,
]);

export default workflow;
