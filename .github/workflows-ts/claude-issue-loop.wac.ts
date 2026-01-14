import { NormalJob, Step, Workflow } from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./lib/enhanced-step";
import { ExtendedNormalJob } from "./lib/enhanced-job";
import { checkoutStep, checkoutWithDepth } from "./lib/steps";
import { claudeIssuePermissions, defaultDefaults } from "./lib/patterns";
import { ISSUE_CONCURRENCY_EXPRESSION } from "./lib/concurrency";
import {
  ghIssueComment,
  ghIssueViewHasLabel,
  ghIssueViewWithComments,
  ghIssueEditRemoveAssignee,
  ghPrListForIssue,
  ghApiCheckProjectStatus,
  ghApiUpdateProjectStatus,
  ghApiCountComments,
  ghApiAddReaction,
  ghPrViewBranch,
} from "./lib/cli/gh";
import { gitConfig, gitCheckoutBranchWithDiff } from "./lib/cli/git";
import { applyTriageSteps } from "./lib/triage-steps";

// =============================================================================
// TRIAGE JOBS
// =============================================================================

// Triage check job
const triageCheckJob = new ExtendedNormalJob("triage-check", {
  "runs-on": "ubuntu-latest",
  if: `(github.event_name == 'issues' &&
 (
   ((github.event.action == 'opened' || github.event.action == 'edited') &&
    !contains(github.event.issue.labels.*.name, 'triaged')) ||
   (github.event.action == 'unlabeled' && github.event.label.name == 'triaged')
 )
) ||
(github.event_name == 'workflow_dispatch' && github.event.inputs.action == 'triage')`,
  steps: [
    // Step 1: Check if this is a sub-issue (shouldn't be triaged)
    new ExtendedStep({
      id: "check",
      name: "gh api graphql (check sub-issue)",
      env: {
        GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
        ISSUE_NUMBER: "${{ github.event.issue.number || github.event.inputs.issue_number }}",
      },
      run: `repo_name="\${GITHUB_REPOSITORY#*/}"
owner="\${GITHUB_REPOSITORY%/*}"

result=$(gh api graphql -H "GraphQL-Features: sub_issues" -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        title
        body
        parent { number }
      }
    }
  }
' \\
  -F owner="$owner" \\
  -F repo="$repo_name" \\
  -F number="$ISSUE_NUMBER" 2>/dev/null || echo '{"data":{"repository":{"issue":null}}}')

issue=$(echo "$result" | jq -r '.data.repository.issue')

if [[ -z "$issue" || "$issue" == "null" ]]; then
  echo "is_sub_issue=false" >> \$GITHUB_OUTPUT
  echo "should_triage=false" >> \$GITHUB_OUTPUT
  echo "issue_title=" >> \$GITHUB_OUTPUT
  {
    echo 'issue_body<<EOF'
    echo ''
    echo 'EOF'
  } >> \$GITHUB_OUTPUT
  exit 0
fi

parent=$(echo "$issue" | jq -r '.parent.number // empty')
title=$(echo "$issue" | jq -r '.title')
body=$(echo "$issue" | jq -r '.body // ""')

if [[ -n "$parent" ]]; then
  echo "is_sub_issue=true" >> \$GITHUB_OUTPUT
  echo "should_triage=false" >> \$GITHUB_OUTPUT
else
  echo "is_sub_issue=false" >> \$GITHUB_OUTPUT
  echo "should_triage=true" >> \$GITHUB_OUTPUT
fi

echo "issue_title=$title" >> \$GITHUB_OUTPUT
echo "issue_number=$ISSUE_NUMBER" >> \$GITHUB_OUTPUT
{
  echo 'issue_body<<EOF'
  echo "$body"
  echo 'EOF'
} >> \$GITHUB_OUTPUT`,
      outputs: ["should_triage", "issue_number", "issue_title", "issue_body", "is_sub_issue"] as const,
    }),
  ] as const,
  outputs: (steps) => ({
    should_triage: steps.check.outputs.should_triage,
    issue_number: steps.check.outputs.issue_number,
    issue_title: steps.check.outputs.issue_title,
    issue_body: steps.check.outputs.issue_body,
  }),
});

// Triage prompt - this is a large multiline string
const triagePrompt = `You are triaging issue #\${{ needs.triage-check.outputs.issue_number }}: "\${{ needs.triage-check.outputs.issue_title }}"

Issue body:
\${{ needs.triage-check.outputs.issue_body }}

## Issue Structure
Issues follow this structure (from task.yml template):
- **Description**: Brief TLDR of what needs to be done
- **Details**: Implementation details, affected files, technical requirements
- **Questions**: Open questions that need answers (checkboxes)
- **Todo**: Specific tasks to complete (checkboxes)

## Your Tasks

### 1. ANALYZE AND WRITE TRIAGE OUTPUT
Analyze the issue and write a JSON file with your triage decisions.
This file is the SINGLE SOURCE OF TRUTH for labels and project fields.

**CRITICAL**: You MUST write this file FIRST before any other actions:

\`\`\`bash
cat > triage-output.json << 'EOF'
{
  "type": "<bug|enhancement|documentation|refactor|test|chore>",
  "priority": "<low|medium|high|critical|null>",
  "size": "<xs|s|m|l|xl>",
  "estimate": <hours as number: 1, 2, 3, 5, 8, 13, or 21>,
  "topics": ["topic_name_1", "topic_name_2"],
  "needs_info": <true|false>
}
EOF
\`\`\`

**How to determine values:**
- **type**: Based on issue category (bug fix, new feature, docs update, etc.)
- **priority**: Extract from "### Priority" section in issue body. If not specified, use \`null\`
  (Note: priority is only used for project fields, NOT as a label)
- **size**: Based on scope of work:
  - XS: < 1 hour, single file change
  - S: 1-3 hours, few files
  - M: 3-8 hours, moderate complexity
  - L: 8-21 hours, significant work
  - XL: 21+ hours, major feature/refactor
- **estimate**: Hours of work (must match size: XS=1, S=2-3, M=5-8, L=13, XL=21)
- **topics**: 1-3 topic names (lowercase with underscores, e.g., "cli_core", "docker_builds")
  - First check existing topics: \`gh label list --search "topic:" --json name --jq '.[].name'\`
  - Reuse existing topics when applicable
- **needs_info**: true if critical information is missing

### 2. SEARCH FOR RELATED CONTENT
- Use \`gh issue list\` to find similar/related issues
- Link to related issues in a comment
- Check if this might be a duplicate

### 3. UPDATE THE ISSUE BODY
Use \`gh issue edit \${{ needs.triage-check.outputs.issue_number }} --body "..."\` to improve the issue:

**Description**: Improve clarity if needed, make it a concise TLDR

**Details**: Expand with technical context:
- Reference specific files/functions that will be affected
- Link to relevant internal docs (files in \`decisions/\`, \`nopo/docs/\`, READMEs)
- Link to external documentation (libraries, APIs, standards)
- Add code snippets or examples if helpful

**Questions**:
- If questions exist, research and answer them (check the box and add answer)
- Add new questions if you identify uncertainties

**Todo**:
- Break down vague tasks into specific, actionable items
- Add missing tasks you identify from analyzing the codebase
- Each todo should be completable in a single commit

### 4. CREATE SUB-ISSUES FOR PHASED WORK
If the issue is large (Size L or XL) and has distinct implementation phases:
1. Identify clear phases in the Todo section (e.g., "Phase 1: Setup", "Phase 2: Core Implementation")
2. Create a sub-issue for each phase using \`gh issue create\`
3. Link each new issue as a sub-issue to this parent issue
4. Each sub-issue should have a focused scope completable in 1-3 days
5. Sub-issues do NOT need full triage structure - just a clear title and todo list

**When to create sub-issues:**
- Work naturally splits into sequential phases
- Different phases could be assigned to different implementers
- Total estimated work exceeds 5 days

**Sub-issue format:**
- Title: "[Sub] Phase N: <phase description> (parent #\${{ needs.triage-check.outputs.issue_number }})"
- Body: Brief description + specific todo items for that phase

### 5. VALIDATE COMPLETENESS
- If critical info is missing, set \`needs_info: true\` in the triage output
- Ask clarifying questions in a comment

## Commands
\`\`\`bash
# STEP 1: Write triage output file (DO THIS FIRST!)
cat > triage-output.json << 'EOF'
{
  "type": "enhancement",
  "priority": "medium",
  "size": "m",
  "estimate": 5,
  "topics": ["cli_core", "docker_builds"],
  "needs_info": false
}
EOF

# Verify the file was created correctly
cat triage-output.json

# View current issue
gh issue view \${{ needs.triage-check.outputs.issue_number }}

# Update issue body (use heredoc for multiline)
gh issue edit \${{ needs.triage-check.outputs.issue_number }} --body "$(cat <<'EOF'
... new body content ...
EOF
)"

# List existing topic labels (to reuse existing topics)
gh label list --search "topic:" --json name --jq '.[].name'

# ============================================
# SUB-ISSUE CREATION (only for L/XL issues)
# ============================================

# Step 1: Create a new issue for a phase
gh issue create --title "[Sub] Phase 1: Setup (parent #\${{ needs.triage-check.outputs.issue_number }})" --body "Phase 1 tasks..."

# Step 2: Get the new issue's ID (from the URL returned by gh issue create)
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) { id }
    }
  }
' -f owner="\${GITHUB_REPOSITORY_OWNER}" -f repo="\${GITHUB_REPOSITORY#*/}" -F number=NEW_ISSUE_NUMBER

# Step 3: Link as sub-issue to parent
gh api graphql -H "GraphQL-Features: sub_issues" -f query='
  mutation($parentId: ID!, $subIssueId: ID!) {
    addSubIssue(input: { issueId: $parentId, subIssueId: $subIssueId }) {
      issue { title }
      subIssue { title }
    }
  }
' -f parentId="PARENT_ISSUE_ID" -f subIssueId="NEW_ISSUE_ID"
\`\`\`

IMPORTANT:
- You MUST write triage-output.json - the workflow step reads your JSON and applies them
- DO NOT add labels yourself - the workflow step reads your JSON and applies them
- DO NOT assign the issue to anyone
- Focus on making the issue clear and actionable for implementation
- Preserve the issue structure (Description, Details, Questions, Todo sections)
- Only create sub-issues if the work genuinely requires phased implementation`;

// Triage job
const triageJob = new NormalJob("triage", {
  needs: ["triage-check"],
  "runs-on": "ubuntu-latest",
  if: "needs.triage-check.outputs.should_triage == 'true'",
  concurrency: {
    group: "claude-triage-${{ needs.triage-check.outputs.issue_number }}",
    "cancel-in-progress": true,
  },
});

triageJob.addSteps([
  checkoutStep,
  // Step 1: Post status comment
  ghIssueComment("bot_comment", {
    GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    ISSUE_NUMBER: "${{ needs.triage-check.outputs.issue_number }}",
    BODY: "👀 **nopo-bot** is triaging this issue...\n\n[View workflow run](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }})",
  }),
  // Step 2: Run Claude for triage
  new Step({
    uses: "anthropics/claude-code-action@v1",
    id: "claude_triage",
    with: {
      claude_code_oauth_token: "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}",
      settings: ".claude/settings.json",
      prompt: triagePrompt,
      claude_args: "--model claude-opus-4-5-20251101 --max-turns 50",
    },
    env: {
      GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    },
  }),
  // Step 3: Apply triage labels and update project fields
  ...applyTriageSteps({
    GH_TOKEN: "${{ secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN }}",
    ISSUE_NUMBER: "${{ needs.triage-check.outputs.issue_number }}",
  }),
  // Step 4: Add reaction on completion
  {
    ...ghApiAddReaction({
      GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
      COMMENT_ID: "${{ steps.bot_comment.outputs.comment_id }}",
      REACTION: "rocket",
    }),
    if: "success()",
  },
  {
    ...ghApiAddReaction({
      GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
      COMMENT_ID: "${{ steps.bot_comment.outputs.comment_id }}",
      REACTION: "eyes",
    }),
    if: "failure()",
  },
]);

// =============================================================================
// IMPLEMENT JOBS
// =============================================================================

// Implement check job
const implementCheckJob = new ExtendedNormalJob("implement-check", {
  "runs-on": "ubuntu-latest",
  if: `github.event.action == 'assigned' &&
github.event_name == 'issues' &&
github.event.assignee.login == 'nopo-bot'`,
  steps: [
    // Step 1: Check if issue has triaged label
    new ExtendedStep({
      id: "check_triaged",
      name: "gh issue view (check label)",
      env: {
        GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
        ISSUE_NUMBER: "${{ github.event.issue.number }}",
        LABEL: "triaged",
      },
      run: `has_label=$(gh issue view "$ISSUE_NUMBER" --repo "\$GITHUB_REPOSITORY" --json labels --jq ".labels[].name" | grep -c "^\$LABEL\$" || true)
echo "has_label=$([[ "$has_label" -gt 0 ]] && echo "true" || echo "false")" >> \$GITHUB_OUTPUT`,
      outputs: ["has_label"] as const,
    }),
    // Step 2: Check project status allows implementation
    new ExtendedStep({
      id: "check_status",
      name: "gh api graphql (check project status)",
      env: {
        GH_TOKEN: "${{ secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN }}",
        ISSUE_NUMBER: "${{ github.event.issue.number }}",
      },
      run: `repo_name="\${GITHUB_REPOSITORY#*/}"
owner="\${GITHUB_REPOSITORY%/*}"

result=$(gh api graphql -f query='
  query($owner: String!, $repo: String!, $issue: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $issue) {
        projectItems(first: 10) {
          nodes {
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
              }
            }
          }
        }
      }
    }
  }
' \\
  -F owner="$owner" \\
  -F repo="$repo_name" \\
  -F issue="$ISSUE_NUMBER" 2>/dev/null || echo '{}')

status=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0].fieldValueByName.name // ""')

echo "status=$status" >> \$GITHUB_OUTPUT

# Can implement if status is empty, Ready, or Backlog
if [[ -z "$status" || "$status" == "Ready" || "$status" == "Backlog" ]]; then
  echo "can_implement=true" >> \$GITHUB_OUTPUT
else
  echo "can_implement=false" >> \$GITHUB_OUTPUT
fi`,
      outputs: ["status", "can_implement"] as const,
    }),
    // Step 3: Get issue details with comments
    new ExtendedStep({
      id: "issue",
      name: "gh issue view (with comments)",
      env: {
        GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
        ISSUE_NUMBER: "${{ github.event.issue.number }}",
      },
      run: `issue=$(gh issue view "$ISSUE_NUMBER" --repo "\$GITHUB_REPOSITORY" --json title,body,labels,comments)
echo "title=$(echo "$issue" | jq -r '.title')" >> \$GITHUB_OUTPUT
{
  echo 'body<<EOF'
  echo "$issue" | jq -r '.body'
  echo 'EOF'
} >> \$GITHUB_OUTPUT
echo "labels=$(echo "$issue" | jq -c '[.labels[].name]')" >> \$GITHUB_OUTPUT
{
  echo 'comments<<EOF'
  echo "$issue" | jq -r '.comments[] | "---\\nAuthor: \\(.author.login)\\n\\(.body)\\n"'
  echo 'EOF'
} >> \$GITHUB_OUTPUT`,
      outputs: ["title", "body", "labels", "comments"] as const,
    }),
    // Step 4: Post status comment
    new ExtendedStep({
      id: "bot_comment",
      name: "gh issue comment",
      env: {
        GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
        ISSUE_NUMBER: "${{ github.event.issue.number }}",
        BODY: "👀 **nopo-bot** is implementing this issue...\n\n[View workflow run](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }})",
      },
      run: `comment_url=$(gh issue comment "$ISSUE_NUMBER" --body "$BODY" --repo "\$GITHUB_REPOSITORY" 2>&1)
comment_id=$(echo "$comment_url" | grep -oE '[0-9]+$' || echo "")
echo "comment_id=$comment_id" >> \$GITHUB_OUTPUT`,
      outputs: ["comment_id"] as const,
    }),
    // Step 5: Check if PR already exists
    new ExtendedStep({
      id: "check_pr",
      name: "gh pr list (for issue)",
      env: {
        GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
        ISSUE_NUMBER: "${{ github.event.issue.number }}",
      },
      run: `# Search for PRs that mention "Fixes #N" or "Closes #N"
prs=$(gh pr list --repo "\$GITHUB_REPOSITORY" --state open --json number,headRefName,url,body)

# Find PR that references this issue
pr=$(echo "$prs" | jq -r --arg issue "$ISSUE_NUMBER" '
  .[] | select(.body | test("(Fixes|Closes|Resolves) #" + $issue + "([^0-9]|$)"; "i"))
' | head -1)

if [[ -n "$pr" && "$pr" != "null" ]]; then
  echo "has_pr=true" >> \$GITHUB_OUTPUT
  echo "pr_number=$(echo "$pr" | jq -r '.number')" >> \$GITHUB_OUTPUT
  echo "pr_branch=$(echo "$pr" | jq -r '.headRefName')" >> \$GITHUB_OUTPUT
  echo "pr_url=$(echo "$pr" | jq -r '.url')" >> \$GITHUB_OUTPUT
else
  echo "has_pr=false" >> \$GITHUB_OUTPUT
  echo "pr_number=" >> \$GITHUB_OUTPUT
  echo "pr_branch=" >> \$GITHUB_OUTPUT
  echo "pr_url=" >> \$GITHUB_OUTPUT
fi`,
      outputs: ["has_pr", "pr_number", "pr_branch", "pr_url"] as const,
    }),
  ] as const,
  outputs: (steps) => ({
    should_implement: "${{ steps.check_pr.outputs.has_pr == 'false' }}",
    issue_title: "${{ github.event.issue.title }}",
    issue_body: steps.issue.outputs.body,
    issue_comments: steps.issue.outputs.comments,
    bot_comment_id: steps.bot_comment.outputs.comment_id,
  }),
});

// Implement update project job
const implementUpdateProjectJob = new NormalJob("implement-update-project", {
  needs: ["implement-check"],
  if: "needs.implement-check.outputs.should_implement == 'true'",
  "runs-on": "ubuntu-latest",
});

implementUpdateProjectJob.addSteps([
  ghApiUpdateProjectStatus({
    GH_TOKEN: "${{ secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN }}",
    ISSUE_NUMBER: "${{ github.event.issue.number }}",
    TARGET_STATUS: "In progress",
  }),
]);

// Implement prompt
const implementPrompt = `Implement issue #\${{ github.event.issue.number }}: "\${{ needs.implement-check.outputs.issue_title }}"

\${{ needs.implement-check.outputs.issue_body }}

You are on branch \`\${{ steps.branch.outputs.name }}\`.
\${{ steps.branch.outputs.existing_branch == 'true' && format('
## ⚠️ EXISTING BRANCH - Previous work detected

This branch already has changes from a previous implementation attempt:
\`\`\`
{0}
\`\`\`

**CRITICAL**: Review what is already done. Do NOT re-implement completed work.
Start from the CURRENT state of the code and continue toward the goal.
If an edit fails because the text is not found, the change may already be applied.
', steps.branch.outputs.diff) || '' }}

## Instructions

1. Follow CLAUDE.md guidelines strictly
2. **FIRST: Run \`git status\` and \`git log -3\` to understand current branch state**
3. **Read each file before editing** - the Edit tool requires this
4. **If an edit fails, re-read the file** - it may already be modified
5. **Never repeat a failed edit** - if text not found, the change is likely done
6. Address Todo items that haven't been completed yet
7. Run \`make check\` and \`make test\` - fix any failures
8. Commit with a descriptive message
9. Push to origin
10. Create DRAFT PR with \`gh pr create --draft --reviewer nopo-bot\`
    - Body MUST contain "Fixes #\${{ github.event.issue.number }}"

If you notice conflicts with other open PRs, note them in the PR description.`;

// Implement job
const implementJob = new NormalJob("implement", {
  needs: ["implement-check", "implement-update-project"],
  if: "always() && needs.implement-check.outputs.should_implement == 'true'",
  "runs-on": "ubuntu-latest",
});

implementJob.addSteps([
  // Step 1: Checkout with full history
  checkoutWithDepth(0),
  // Step 2: Configure Git
  gitConfig({
    USER_NAME: "Claude Bot",
    USER_EMAIL: "claude-bot@anthropic.com",
  }),
  // Step 3: Create or checkout branch (with diff for existing)
  gitCheckoutBranchWithDiff("branch", {
    BRANCH_NAME: "claude/issue/${{ github.event.issue.number }}",
  }),
  // Step 4: Run Claude to implement
  new Step({
    uses: "anthropics/claude-code-action@v1",
    with: {
      claude_code_oauth_token: "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}",
      github_token: "${{ secrets.GITHUB_TOKEN }}",
      assignee_trigger: "nopo-bot",
      settings: ".claude/settings.json",
      show_full_output: "true",
      prompt: implementPrompt,
      claude_args: "--model claude-opus-4-5-20251101 --max-turns 200",
    },
    env: {
      GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    },
  }),
  // Step 5: Salvage partial progress on failure
  new Step({
    name: "Salvage partial progress",
    if: "failure()",
    env: {
      GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
      ISSUE_NUMBER: "${{ github.event.issue.number }}",
      BRANCH_NAME: "${{ steps.branch.outputs.name }}",
    },
    run: `# Check if there are uncommitted changes
if ! git diff --quiet HEAD 2>/dev/null; then
  git add -A
  git commit -m "WIP: Partial implementation progress

Fixes #$ISSUE_NUMBER" || true
  git push origin "$BRANCH_NAME" || true

  # Create draft PR if it doesn't exist
  existing_pr=$(gh pr list --head "$BRANCH_NAME" --json number --jq '.[0].number')
  if [[ -z "$existing_pr" ]]; then
    gh pr create --draft --title "WIP: Implementation for #$ISSUE_NUMBER" \
      --body "Fixes #$ISSUE_NUMBER

**Note**: This is partial progress from an interrupted implementation." \
      --reviewer nopo-bot || true
  fi
fi`,
  }),
  // Step 6: Add reaction on completion
  {
    ...ghApiAddReaction({
      GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
      COMMENT_ID: "${{ needs.implement-check.outputs.bot_comment_id }}",
      REACTION: "rocket",
    }),
    if: "success()",
  },
  {
    ...ghApiAddReaction({
      GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
      COMMENT_ID: "${{ needs.implement-check.outputs.bot_comment_id }}",
      REACTION: "eyes",
    }),
    if: "failure()",
  },
  // Step 7: Unassign nopo-bot on failure
  {
    ...ghIssueEditRemoveAssignee({
      GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
      ISSUE_NUMBER: "${{ github.event.issue.number }}",
      ASSIGNEES: "nopo-bot",
    }),
    if: "failure()",
  },
]);

// =============================================================================
// COMMENT JOBS
// =============================================================================

// Comment prompt
const commentPrompt = `You are responding to a question or request in a GitHub \${{ steps.pr_context.outputs.is_pr == 'true' && 'PR' || 'issue' }} comment.

\${{ steps.pr_context.outputs.is_pr == 'true' && format('This is PR #{0} on branch \`{1}\`. You are checked out on the PR branch with the code changes.', github.event.issue.number, steps.pr_context.outputs.branch) || format('This is issue #{0}. You are checked out on main.', github.event.issue.number) }}

## Your Task

Read the user's comment carefully and respond ONLY to what they asked.
DO NOT make unrelated suggestions or analyze unrelated code.

## Action Detection

**If the user's comment contains ACTION WORDS** like:
- "fix", "implement", "change", "update", "add", "remove", "refactor", "delete"
- "do it", "make it", "apply", "commit", "push"

Then **DO IT IMMEDIATELY** - make the code changes and push them. Do NOT ask
"Would you like me to..." or "Should I..." - the user explicitly asked, so act.

**If the comment is a QUESTION or ANALYSIS REQUEST** (no action words):
- Answer the question
- Explain the code
- Suggest approaches (let user decide if they want implementation)

For large-scale implementation (new features), users should:
- Assign \`nopo-bot\` to an issue for full implementation

Focus on:
- Detecting whether this is an ACTION REQUEST or a QUESTION
- For actions: implement immediately, commit, and push
- For questions: provide clear, helpful answers

## IMPORTANT: Always Post Your Response

After completing your analysis, you MUST post your response as a comment:
\`\`\`
gh issue comment \${{ github.event.issue.number }} --repo "$GITHUB_REPOSITORY" --body "## Response

<your detailed response to the user's SPECIFIC question/request>"
\`\`\`

NEVER leave the issue/PR without a visible response - your analysis must be posted as a comment.`;

// Comment job
const commentJob = new NormalJob("comment", {
  "runs-on": "ubuntu-latest",
  if: `(github.event_name == 'issue_comment' || github.event_name == 'pull_request_review_comment') &&
contains(github.event.comment.body, '@claude') &&
github.event.comment.user.type != 'Bot'`,
});

commentJob.addSteps([
  // Step 1: Post status comment
  ghIssueComment("bot_comment", {
    GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    ISSUE_NUMBER:
      "${{ github.event.issue.number || github.event.pull_request.number }}",
    BODY: "👀 **nopo-bot** is responding to your request...\n\n[View workflow run](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }})",
  }),
  // Step 2: Count Claude's previous comments (circuit breaker)
  ghApiCountComments("count_comments", {
    GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    PR_NUMBER:
      "${{ github.event.issue.number || github.event.pull_request.number }}",
    USER_LOGIN: "claude[bot]",
  }),
  // Step 3: Check comment limit
  new Step({
    id: "check_limit",
    name: "Check comment limit",
    env: {
      COMMENT_COUNT: "${{ steps.count_comments.outputs.count }}",
      MAX_COMMENTS: "50",
    },
    run: `if [[ "$COMMENT_COUNT" -ge "$MAX_COMMENTS" ]]; then
  echo "exceeded=true" >> $GITHUB_OUTPUT
  echo "Claude has made $COMMENT_COUNT comments (max: $MAX_COMMENTS). Stopping."
else
  echo "exceeded=false" >> $GITHUB_OUTPUT
fi`,
  }),
  // Step 4: Get PR branch context
  ghPrViewBranch("pr_context", {
    GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    IS_PR: "${{ github.event.issue.pull_request != '' }}",
    PR_NUMBER: "${{ github.event.issue.number }}",
  }),
  // Step 5: Checkout
  new Step({
    if: "steps.check_limit.outputs.exceeded == 'false'",
    uses: "actions/checkout@v4",
    with: {
      ref: "${{ steps.pr_context.outputs.branch }}",
      "fetch-depth": 0,
    },
  }),
  // Step 6: Run Claude
  new Step({
    if: "steps.check_limit.outputs.exceeded == 'false'",
    uses: "anthropics/claude-code-action@v1",
    with: {
      claude_code_oauth_token: "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}",
      settings: ".claude/settings.json",
      trigger_phrase: "@claude",
      prompt: commentPrompt,
      claude_args: "--model claude-opus-4-5-20251101 --max-turns 100",
    },
    env: {
      GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    },
  }),
  // Step 7: Add reaction on completion
  {
    ...ghApiAddReaction({
      GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
      COMMENT_ID: "${{ steps.bot_comment.outputs.comment_id }}",
      REACTION: "rocket",
    }),
    if: "success()",
  },
  {
    ...ghApiAddReaction({
      GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
      COMMENT_ID: "${{ steps.bot_comment.outputs.comment_id }}",
      REACTION: "eyes",
    }),
    if: "failure()",
  },
]);

// =============================================================================
// MAIN WORKFLOW
// =============================================================================

export const claudeIssueLoopWorkflow = new Workflow("claude-issue-loop", {
  name: "Claude Issue Loop",
  on: {
    issues: {
      types: ["opened", "edited", "assigned", "unlabeled"],
    },
    issue_comment: {
      types: ["created"],
    },
    pull_request_review_comment: {
      types: ["created"],
    },
    workflow_dispatch: {
      inputs: {
        issue_number: {
          description: "Issue number to process",
          required: true,
          type: "string",
        },
        action: {
          description: "Action to simulate",
          required: true,
          type: "choice",
          options: ["triage", "implement", "respond"],
        },
      },
    },
  },
  concurrency: {
    group: ISSUE_CONCURRENCY_EXPRESSION,
    "cancel-in-progress": false,
  },
  permissions: claudeIssuePermissions,
  defaults: defaultDefaults,
});

claudeIssueLoopWorkflow.addJobs([
  triageCheckJob,
  triageJob,
  implementCheckJob,
  implementUpdateProjectJob,
  implementJob,
  commentJob,
]);
