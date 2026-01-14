import { NormalJob, Step, Workflow } from "@github-actions-workflow-ts/lib";
import { checkoutStep } from "./lib/steps";
import { claudeCIPermissions, defaultDefaults } from "./lib/patterns";
import {
  updateProjectStatusStep,
  markPRReadyStep,
  requestPRReviewersStep,
} from "./lib/gh";
import {
  checkClaudeCommentCountStep,
  checkUnresolvedCommentsStep,
  convertPRToDraftStep,
  findPRForBranchStep,
} from "./lib/ci-steps";
import { ghPrReady } from "./lib/gh-cli";

// =============================================================================
// PUSH JOBS
// =============================================================================

// Push convert to draft job
const pushConvertToDraftJob = new NormalJob("push-convert-to-draft", {
  if: `github.event_name == 'push' &&
!startsWith(github.ref_name, 'gh-readonly-queue/')`,
  "runs-on": "ubuntu-latest",
  concurrency: {
    group: "claude-review-${{ github.ref_name }}",
    "cancel-in-progress": true,
  },
});

pushConvertToDraftJob.addSteps([
  checkoutStep,
  convertPRToDraftStep({
    GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    HEAD_BRANCH: "${{ github.ref_name }}",
  }),
]);

// =============================================================================
// CHECK PR JOB (shared info job)
// =============================================================================

// Check PR job
const checkPRJob = new NormalJob("check-pr", {
  if: "github.event_name == 'workflow_run' || github.event_name == 'workflow_dispatch'",
  "runs-on": "ubuntu-latest",
  outputs: {
    has_pr: "${{ steps.check.outputs.has_pr }}",
    is_claude_pr: "${{ steps.check.outputs.is_claude_pr }}",
    is_draft: "${{ steps.check.outputs.is_draft }}",
    pr_number: "${{ steps.check.outputs.pr_number }}",
    pr_head_branch: "${{ steps.check.outputs.pr_head_branch }}",
    pr_body: "${{ steps.check.outputs.pr_body }}",
    has_issue: "${{ steps.check.outputs.has_issue }}",
    issue_number: "${{ steps.check.outputs.issue_number }}",
    conclusion: "${{ steps.check.outputs.conclusion }}",
  },
});

checkPRJob.addSteps([
  checkoutStep,
  findPRForBranchStep("check", {
    GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    HEAD_BRANCH: "${{ github.event.workflow_run.head_branch }}",
    INPUT_PR_NUMBER: "${{ inputs.pr_number }}",
    INPUT_CONCLUSION: "${{ inputs.conclusion }}",
  }),
]);

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
  new Step({
    name: "Convert PR to draft",
    env: {
      GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
      PR_NUMBER: "${{ needs.check-pr.outputs.pr_number }}",
    },
    run: `gh pr ready "$PR_NUMBER" --undo --repo "$GITHUB_REPOSITORY"
echo "Converted PR #$PR_NUMBER to draft due to CI failure"`,
  }),
]);

// CI failure fix prompt
const ciFailureFixPrompt = `The CI build failed for PR #\${{ needs.check-pr.outputs.pr_number }} on branch \${{ needs.check-pr.outputs.pr_head_branch }}.

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
  checkoutStep,
  checkClaudeCommentCountStep({
    GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    PR_NUMBER: "${{ needs.check-pr.outputs.pr_number }}",
  }),
  new Step({
    uses: "actions/checkout@v4",
    with: {
      ref: "${{ needs.check-pr.outputs.pr_head_branch }}",
      "fetch-depth": 0,
    },
  }),
  new Step({
    name: "Configure Git",
    run: `git config --global user.name "Claude Bot"
git config --global user.email "claude-bot@anthropic.com"`,
  }),
  new Step({
    uses: "anthropics/claude-code-action@v1",
    with: {
      claude_code_oauth_token: "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}",
      settings: ".claude/settings.json",
      prompt: ciFailureFixPrompt,
      claude_args: "--model claude-opus-4-5-20251101 --max-turns 200",
    },
    env: {
      GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    },
  }),
]);

// CI failure suggest fixes prompt
const ciFailureSuggestFixesPrompt = `The CI build failed for PR #\${{ needs.check-pr.outputs.pr_number }} on branch \${{ needs.check-pr.outputs.pr_head_branch }}.

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
gh pr review \${{ needs.check-pr.outputs.pr_number }} --comment --body "## CI Failure Analysis

**Root Cause:** <description>

**Suggested Fixes:**
<specific code suggestions with file paths and line numbers>"

# For inline comments on specific files/lines:
gh api repos/$GITHUB_REPOSITORY/pulls/\${{ needs.check-pr.outputs.pr_number }}/comments \\
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
      ref: "${{ needs.check-pr.outputs.pr_head_branch }}",
      "fetch-depth": 0,
    },
  }),
  new Step({
    uses: "anthropics/claude-code-action@v1",
    with: {
      claude_code_oauth_token: "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}",
      settings: ".claude/settings.json",
      prompt: ciFailureSuggestFixesPrompt,
      claude_args: "--model claude-opus-4-5-20251101 --max-turns 200",
    },
    env: {
      GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    },
  }),
]);

// =============================================================================
// CI SUCCESS JOBS
// =============================================================================

// Comment if unresolved script (keep inline - simple)
const commentIfUnresolvedScript = `
echo "Skipping move to Review - $UNRESOLVED_COUNT unresolved comment thread(s)"

gh pr comment "$PR_NUMBER" --body "⏸️ **CI passed but not moving to Review**

There are **$UNRESOLVED_COUNT unresolved comment thread(s)** on this PR.

Please resolve all comments before the PR can move to Review status."
`.trim();

// Success check comments job
const successCheckCommentsJob = new NormalJob("success-check-comments", {
  needs: ["check-pr"],
  if: `(github.event.workflow_run.conclusion == 'success' || needs.check-pr.outputs.conclusion == 'success') &&
needs.check-pr.outputs.has_pr == 'true'`,
  "runs-on": "ubuntu-latest",
  outputs: {
    has_unresolved: "${{ steps.comments.outputs.has_unresolved }}",
    unresolved_count: "${{ steps.comments.outputs.unresolved_count }}",
  },
});

successCheckCommentsJob.addSteps([
  checkoutStep,
  checkUnresolvedCommentsStep("comments", {
    GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    PR_NUMBER: "${{ needs.check-pr.outputs.pr_number }}",
  }),
  new Step({
    name: "Comment if unresolved",
    if: "steps.comments.outputs.has_unresolved == 'true'",
    env: {
      GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
      PR_NUMBER: "${{ needs.check-pr.outputs.pr_number }}",
      UNRESOLVED_COUNT: "${{ steps.comments.outputs.unresolved_count }}",
    },
    run: commentIfUnresolvedScript,
  }),
]);

// Success update project job
const successUpdateProjectJob = new NormalJob("success-update-project", {
  needs: ["check-pr", "success-check-comments"],
  if: `(github.event.workflow_run.conclusion == 'success' || needs.check-pr.outputs.conclusion == 'success') &&
needs.check-pr.outputs.has_issue == 'true' &&
needs.success-check-comments.outputs.has_unresolved != 'true'`,
  "runs-on": "ubuntu-latest",
});

successUpdateProjectJob.addSteps([
  checkoutStep,
  updateProjectStatusStep({
    GH_TOKEN: "${{ secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN }}",
    ISSUE_NUMBER: "${{ needs.check-pr.outputs.issue_number }}",
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
  markPRReadyStep({
    GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    PR_NUMBER: "${{ needs.check-pr.outputs.pr_number }}",
  }),
  new Step({
    name: "Add review-ready label",
    env: {
      GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
      PR_NUMBER: "${{ needs.check-pr.outputs.pr_number }}",
    },
    run: 'gh pr edit "$PR_NUMBER" --add-label "review-ready" || true',
  }),
  requestPRReviewersStep({
    GH_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
    PR_NUMBER: "${{ needs.check-pr.outputs.pr_number }}",
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
