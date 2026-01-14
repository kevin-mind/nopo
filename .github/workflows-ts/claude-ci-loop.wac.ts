import { NormalJob, Step, Workflow, expressions } from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./lib/enhanced-step";
import { ExtendedNormalJob } from "./lib/enhanced-job";
import { claudeCIPermissions, defaultDefaults } from "./lib/patterns";
import {
  ghPrList,
  ghPrReady,
  ghPrReadyUndo,
  ghPrEditAddReviewer,
  ghPrEditAddLabel,
  ghPrComment,
  ghApiCountComments,
  ghApiUpdateProjectStatus,
} from "./lib/cli/gh";
import { gitConfig } from "./lib/cli/git";

// =============================================================================
// PUSH JOBS
// =============================================================================

// Push convert to draft job
const pushConvertToDraftJob = new NormalJob("push-convert-to-draft", {
  if: `github.event_name == 'push' &&
!startsWith(github.ref_name, 'gh-readonly-queue/')`,
  "runs-on": "ubuntu-latest",
  concurrency: {
    group: `claude-review-${expressions.expn("github.ref_name")}`,
    "cancel-in-progress": true,
  },
});

pushConvertToDraftJob.addSteps([
  // Step 1: Find PR for this branch
  ghPrList("get_pr", {
    GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
    HEAD_BRANCH: expressions.expn("github.ref_name"),
  }),
  // Step 2: Convert to draft if PR exists and is ready
  {
    ...ghPrReadyUndo({
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      PR_NUMBER: expressions.expn("steps.get_pr.outputs.number"),
    }),
    if: "steps.get_pr.outputs.found == 'true' && steps.get_pr.outputs.is_draft == 'false'",
  },
]);

// =============================================================================
// CHECK PR JOB (shared info job)
// =============================================================================

// Check PR job - handles both workflow_run and workflow_dispatch
const checkPRJob = new ExtendedNormalJob("check-pr", {
  if: "github.event_name == 'workflow_run' || github.event_name == 'workflow_dispatch'",
  "runs-on": "ubuntu-latest",
  steps: [
    // Step 1: Determine CI conclusion from inputs or event
    new ExtendedStep({
      id: "conclusion",
      name: "Determine conclusion",
      env: {
        INPUT_CONCLUSION: expressions.expn("inputs.conclusion"),
        EVENT_CONCLUSION: expressions.expn("github.event.workflow_run.conclusion"),
      },
      run: `if [[ -n "$INPUT_CONCLUSION" ]]; then
  echo "conclusion=$INPUT_CONCLUSION" >> \$GITHUB_OUTPUT
else
  echo "conclusion=$EVENT_CONCLUSION" >> \$GITHUB_OUTPUT
fi`,
      outputs: ["conclusion"] as const,
    }),
    // Step 2: Get PR details (supports both HEAD_BRANCH and PR_NUMBER lookup)
    new ExtendedStep({
      id: "check",
      name: "gh pr view (extended)",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        HEAD_BRANCH: expressions.expn("github.event.workflow_run.head_branch"),
        PR_NUMBER: expressions.expn("inputs.pr_number"),
      },
      run: `# Determine how to find the PR
if [[ -n "$PR_NUMBER" ]]; then
  pr=$(gh pr view "$PR_NUMBER" --repo "\$GITHUB_REPOSITORY" --json number,isDraft,author,headRefName,body 2>/dev/null || echo "")
elif [[ -n "$HEAD_BRANCH" ]]; then
  pr=$(gh pr list --repo "\$GITHUB_REPOSITORY" --head "$HEAD_BRANCH" --json number,isDraft,author,headRefName,body --jq '.[0]' 2>/dev/null || echo "")
else
  echo "Either PR_NUMBER or HEAD_BRANCH must be provided"
  exit 1
fi

# Check if PR was found
if [[ -z "$pr" || "$pr" == "null" ]]; then
  echo "has_pr=false" >> \$GITHUB_OUTPUT
  echo "is_claude_pr=false" >> \$GITHUB_OUTPUT
  echo "is_draft=false" >> \$GITHUB_OUTPUT
  echo "pr_number=" >> \$GITHUB_OUTPUT
  echo "pr_head_branch=" >> \$GITHUB_OUTPUT
  echo "has_issue=false" >> \$GITHUB_OUTPUT
  echo "issue_number=" >> \$GITHUB_OUTPUT
  {
    echo 'pr_body<<EOF'
    echo ''
    echo 'EOF'
  } >> \$GITHUB_OUTPUT
  exit 0
fi

# Extract PR fields
pr_number=$(echo "$pr" | jq -r '.number')
is_draft=$(echo "$pr" | jq -r '.isDraft')
author=$(echo "$pr" | jq -r '.author.login')
head_branch=$(echo "$pr" | jq -r '.headRefName')
body=$(echo "$pr" | jq -r '.body // ""')

# Check if Claude PR (author or branch pattern)
is_claude_pr="false"
if [[ "$author" == "claude[bot]" || "$head_branch" == claude/* ]]; then
  is_claude_pr="true"
fi

# Extract issue number from PR body (Fixes #123 pattern)
issue_number=$(echo "$body" | grep -oE '(Fixes|Closes|Resolves) #[0-9]+' | head -1 | grep -oE '[0-9]+' || echo "")
has_issue="false"
if [[ -n "$issue_number" ]]; then
  has_issue="true"
fi

# Output all values
echo "has_pr=true" >> \$GITHUB_OUTPUT
echo "is_claude_pr=$is_claude_pr" >> \$GITHUB_OUTPUT
echo "is_draft=$is_draft" >> \$GITHUB_OUTPUT
echo "pr_number=$pr_number" >> \$GITHUB_OUTPUT
echo "pr_head_branch=$head_branch" >> \$GITHUB_OUTPUT
echo "has_issue=$has_issue" >> \$GITHUB_OUTPUT
echo "issue_number=$issue_number" >> \$GITHUB_OUTPUT
{
  echo 'pr_body<<EOF'
  echo "$body"
  echo 'EOF'
} >> \$GITHUB_OUTPUT`,
      outputs: ["has_pr", "is_claude_pr", "is_draft", "pr_number", "pr_head_branch", "pr_body", "has_issue", "issue_number"] as const,
    }),
  ] as const,
  outputs: (steps) => ({
    has_pr: steps.check.outputs.has_pr,
    is_claude_pr: steps.check.outputs.is_claude_pr,
    is_draft: steps.check.outputs.is_draft,
    pr_number: steps.check.outputs.pr_number,
    pr_head_branch: steps.check.outputs.pr_head_branch,
    pr_body: steps.check.outputs.pr_body,
    has_issue: steps.check.outputs.has_issue,
    issue_number: steps.check.outputs.issue_number,
    conclusion: steps.conclusion.outputs.conclusion,
  }),
});

// =============================================================================
// CI FAILURE JOBS
// =============================================================================

// Failure convert to draft job
const failureConvertToDraftJob = new NormalJob("failure-convert-to-draft", {
  needs: ["check-pr"],
  if: `(github.event.workflow_run.conclusion == 'failure' || needs.check-pr.outputs.conclusion == 'failure') &&
needs.check-pr.outputs.has_pr == 'true' &&
needs.check-pr.outputs.is_claude_pr == 'true' &&
needs.check-pr.outputs.is_draft == 'false'`,
  "runs-on": "ubuntu-latest",
});

failureConvertToDraftJob.addSteps([
  ghPrReadyUndo({
    GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
    PR_NUMBER: expressions.expn("needs.check-pr.outputs.pr_number"),
  }),
  new Step({
    name: "Log conversion",
    run: `echo "Converted PR #${expressions.expn("needs.check-pr.outputs.pr_number")} to draft due to CI failure"`,
  }),
]);

// CI failure fix prompt
const ciFailureFixPrompt = `The CI build failed for PR #${expressions.expn("needs.check-pr.outputs.pr_number")} on branch ${expressions.expn("needs.check-pr.outputs.pr_head_branch")}.

1. Analyze the project to understand the build and test process (see CLAUDE.md).
2. Run \`make check\` and \`make test\` to reproduce the failure.
3. Fix the issue.
4. Verify the fix by running tests again.
5. Push the changes to the same branch.

This is an automated CI fix loop - focus on fixing the specific failure.`;

// Failure fix and push job
const failureFixAndPushJob = new NormalJob("failure-fix-and-push", {
  needs: ["check-pr", "failure-convert-to-draft"],
  if: `(github.event.workflow_run.conclusion == 'failure' || needs.check-pr.outputs.conclusion == 'failure') &&
(needs.failure-convert-to-draft.result == 'success' || needs.failure-convert-to-draft.result == 'skipped') &&
needs.check-pr.outputs.has_pr == 'true' &&
needs.check-pr.outputs.is_claude_pr == 'true'`,
  "runs-on": "ubuntu-latest",
});

failureFixAndPushJob.addSteps([
  // Step 1: Count Claude's previous comments (circuit breaker)
  ghApiCountComments("count_comments", {
    GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
    PR_NUMBER: expressions.expn("needs.check-pr.outputs.pr_number"),
    USER_LOGIN: "claude[bot]",
  }),
  // Step 2: Check comment limit
  new Step({
    id: "check_limit",
    name: "Check comment limit",
    env: {
      COMMENT_COUNT: expressions.expn("steps.count_comments.outputs.count"),
      MAX_COMMENTS: "50",
    },
    run: `if [[ "$COMMENT_COUNT" -ge "$MAX_COMMENTS" ]]; then
  echo "exceeded=true" >> $GITHUB_OUTPUT
  echo "Claude has made $COMMENT_COUNT comments (max: $MAX_COMMENTS). Stopping to prevent infinite loop."
else
  echo "exceeded=false" >> $GITHUB_OUTPUT
fi`,
  }),
  // Step 3: Checkout the PR branch
  new Step({
    if: "steps.check_limit.outputs.exceeded == 'false'",
    uses: "actions/checkout@v4",
    with: {
      ref: expressions.expn("needs.check-pr.outputs.pr_head_branch"),
      "fetch-depth": 0,
    },
  }),
  // Step 4: Configure Git
  {
    ...gitConfig({
      USER_NAME: "Claude Bot",
      USER_EMAIL: "claude-bot@anthropic.com",
    }),
    if: "steps.check_limit.outputs.exceeded == 'false'",
  },
  // Step 5: Run Claude to fix the issue
  new Step({
    if: "steps.check_limit.outputs.exceeded == 'false'",
    uses: "anthropics/claude-code-action@v1",
    with: {
      claude_code_oauth_token: expressions.secret("CLAUDE_CODE_OAUTH_TOKEN"),
      settings: ".claude/settings.json",
      prompt: ciFailureFixPrompt,
      claude_args: "--model claude-opus-4-5-20251101 --max-turns 200",
    },
    env: {
      GITHUB_TOKEN: expressions.secret("GITHUB_TOKEN"),
    },
  }),
]);

// CI failure suggest fixes prompt
const ciFailureSuggestFixesPrompt = `The CI build failed for PR #${expressions.expn("needs.check-pr.outputs.pr_number")} on branch ${expressions.expn("needs.check-pr.outputs.pr_head_branch")}.

This is a human-created PR, so DO NOT push any changes directly.

Instead:
1. Analyze the project to understand the build and test process (see CLAUDE.md).
2. Run \`make check\` and \`make test\` to reproduce the failure.
3. Identify the root cause of the failure.
4. Submit a PR review with your findings and suggestions.

## IMPORTANT: Always Post Visible Feedback

You MUST submit a PR review with your analysis. Use one of:
\`\`\`
# If you have specific fix suggestions:
gh pr review ${expressions.expn("needs.check-pr.outputs.pr_number")} --comment --body "## CI Failure Analysis

**Root Cause:** <description>

**Suggested Fixes:**
<specific code suggestions with file paths and line numbers>"

# For inline comments on specific files/lines:
gh api repos/$GITHUB_REPOSITORY/pulls/${expressions.expn("needs.check-pr.outputs.pr_number")}/comments \\
  -f body="suggestion" -f path="file.ts" -f line=42 -f side="RIGHT"
\`\`\`

NEVER leave the PR without feedback - even if you can't identify the exact issue,
post what you found and any partial analysis.

Be helpful and specific - the human author should be able to easily apply your suggestions.`;

// Failure suggest fixes job (for human PRs)
const failureSuggestFixesJob = new NormalJob("failure-suggest-fixes", {
  needs: ["check-pr"],
  if: `(github.event.workflow_run.conclusion == 'failure' || needs.check-pr.outputs.conclusion == 'failure') &&
needs.check-pr.outputs.has_pr == 'true' &&
needs.check-pr.outputs.is_claude_pr == 'false'`,
  "runs-on": "ubuntu-latest",
});

failureSuggestFixesJob.addSteps([
  new Step({
    uses: "actions/checkout@v4",
    with: {
      ref: expressions.expn("needs.check-pr.outputs.pr_head_branch"),
      "fetch-depth": 0,
    },
  }),
  new Step({
    uses: "anthropics/claude-code-action@v1",
    with: {
      claude_code_oauth_token: expressions.secret("CLAUDE_CODE_OAUTH_TOKEN"),
      settings: ".claude/settings.json",
      prompt: ciFailureSuggestFixesPrompt,
      claude_args: "--model claude-opus-4-5-20251101 --max-turns 200",
    },
    env: {
      GITHUB_TOKEN: expressions.secret("GITHUB_TOKEN"),
    },
  }),
]);

// =============================================================================
// CI SUCCESS JOBS
// =============================================================================

// Success check comments job
const successCheckCommentsJob = new ExtendedNormalJob("success-check-comments", {
  needs: ["check-pr"],
  if: `(github.event.workflow_run.conclusion == 'success' || needs.check-pr.outputs.conclusion == 'success') &&
needs.check-pr.outputs.has_pr == 'true'`,
  "runs-on": "ubuntu-latest",
  steps: [
    // Step 1: Check for unresolved comments via GraphQL
    new ExtendedStep({
      id: "comments",
      name: "gh api graphql (unresolved comments)",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        PR_NUMBER: expressions.expn("needs.check-pr.outputs.pr_number"),
      },
      run: `repo_name="\${GITHUB_REPOSITORY#*/}"
owner="\${GITHUB_REPOSITORY%/*}"

result=$(gh api graphql -f query='
  query($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100) {
          nodes {
            isResolved
          }
        }
      }
    }
  }
' \\
  -F owner="$owner" \\
  -F repo="$repo_name" \\
  -F pr="$PR_NUMBER")

unresolved_count=$(echo "$result" | jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length')
echo "unresolved_count=$unresolved_count" >> \$GITHUB_OUTPUT
echo "has_unresolved=$([[ "$unresolved_count" -gt 0 ]] && echo "true" || echo "false")" >> \$GITHUB_OUTPUT`,
      outputs: ["has_unresolved", "unresolved_count"] as const,
    }),
    // Step 2: Comment if there are unresolved threads
    new ExtendedStep({
      id: "notify",
      name: "gh pr comment",
      if: "steps.comments.outputs.has_unresolved == 'true'",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        PR_NUMBER: expressions.expn("needs.check-pr.outputs.pr_number"),
        BODY: `⏸️ **CI passed but not moving to Review**

There are **${expressions.expn("steps.comments.outputs.unresolved_count")} unresolved comment thread(s)** on this PR.

Please resolve all comments before the PR can move to Review status.`,
      },
      run: `comment_url=$(gh pr comment "$PR_NUMBER" --body "$BODY" --repo "\$GITHUB_REPOSITORY" 2>&1)
comment_id=$(echo "$comment_url" | grep -oE '[0-9]+$' || echo "")
echo "comment_id=$comment_id" >> \$GITHUB_OUTPUT`,
    }),
  ] as const,
  outputs: (steps) => ({
    has_unresolved: steps.comments.outputs.has_unresolved,
    unresolved_count: steps.comments.outputs.unresolved_count,
  }),
});

// Success update project job
const successUpdateProjectJob = new NormalJob("success-update-project", {
  needs: ["check-pr", "success-check-comments"],
  if: `(github.event.workflow_run.conclusion == 'success' || needs.check-pr.outputs.conclusion == 'success') &&
needs.check-pr.outputs.has_issue == 'true' &&
needs.success-check-comments.outputs.has_unresolved != 'true'`,
  "runs-on": "ubuntu-latest",
});

successUpdateProjectJob.addSteps([
  ghApiUpdateProjectStatus({
    GH_TOKEN: expressions.expn("secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN"),
    ISSUE_NUMBER: expressions.expn("needs.check-pr.outputs.issue_number"),
    TARGET_STATUS: "In review",
  }),
]);

// Success ready for review job
const successReadyForReviewJob = new NormalJob("success-ready-for-review", {
  needs: ["check-pr", "success-check-comments", "success-update-project"],
  if: `always() &&
(github.event.workflow_run.conclusion == 'success' || needs.check-pr.outputs.conclusion == 'success') &&
needs.check-pr.outputs.has_pr == 'true' &&
needs.success-check-comments.outputs.has_unresolved != 'true'`,
  "runs-on": "ubuntu-latest",
});

successReadyForReviewJob.addSteps([
  // Step 1: Mark PR as ready
  ghPrReady({
    GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
    PR_NUMBER: expressions.expn("needs.check-pr.outputs.pr_number"),
  }),
  // Step 2: Add review-ready label
  ghPrEditAddLabel({
    GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
    PR_NUMBER: expressions.expn("needs.check-pr.outputs.pr_number"),
    LABEL: "review-ready",
  }),
  // Step 3: Request nopo-bot as reviewer
  ghPrEditAddReviewer({
    GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
    PR_NUMBER: expressions.expn("needs.check-pr.outputs.pr_number"),
    REVIEWERS: "nopo-bot",
  }),
]);

// =============================================================================
// MAIN WORKFLOW
// =============================================================================

export const claudeCILoopWorkflow = new Workflow("claude-ci-loop", {
  name: "Claude CI Loop",
  on: {
    push: {
      "branches-ignore": ["main"],
    },
    workflow_run: {
      workflows: ["CI", "Release"],
      types: ["completed"],
    },
    workflow_dispatch: {
      inputs: {
        pr_number: {
          description: "PR number to process",
          required: true,
          type: "string",
        },
        conclusion: {
          description: "Simulated workflow conclusion",
          required: true,
          type: "choice",
          options: ["failure", "success"],
          default: "failure",
        },
      },
    },
  },
  permissions: claudeCIPermissions,
  defaults: defaultDefaults,
});

claudeCILoopWorkflow.addJobs([
  pushConvertToDraftJob,
  checkPRJob,
  failureConvertToDraftJob,
  failureFixAndPushJob,
  failureSuggestFixesJob,
  successCheckCommentsJob,
  successUpdateProjectJob,
  successReadyForReviewJob,
]);
