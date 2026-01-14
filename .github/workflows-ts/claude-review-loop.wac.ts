import {
  NormalJob,
  Step,
  Workflow,
  expressions,
} from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./lib/enhanced-step";
import { ExtendedNormalJob } from "./lib/enhanced-job";
import { claudeReviewPermissions, defaultDefaults } from "./lib/patterns";
import {
  ghPrComment,
  ghPrViewCheckClaude,
  ghPrEditRemoveReviewer,
  ghApiUpdateProjectStatus,
  ghApiAddReaction,
} from "./lib/cli/gh";
import { gitConfig } from "./lib/cli/git";

// =============================================================================
// REVIEW REQUEST JOBS
// =============================================================================

// Request setup job
const requestSetupJob = new ExtendedNormalJob("request-setup", {
  if: `github.event_name == 'pull_request' &&
github.event.requested_reviewer.login == 'nopo-bot'`,
  "runs-on": "ubuntu-latest",
  steps: [
    // Step 1: Check if draft PR (skip review)
    new ExtendedStep({
      id: "check_draft",
      name: "Check if draft",
      if: "github.event.pull_request.draft == true",
      run: `echo "::warning::PR #${expressions.expn("github.event.pull_request.number")} is a draft. Skipping review."
exit 1`,
    }),
    // Step 2: Post status comment
    new ExtendedStep({
      id: "bot_comment",
      name: "gh pr comment",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        PR_NUMBER: expressions.expn("github.event.pull_request.number"),
        BODY: `👀 **nopo-bot** is reviewing this PR...\n\n[View workflow run](${expressions.expn("github.server_url")}/${expressions.expn("github.repository")}/actions/runs/${expressions.expn("github.run_id")})`,
      },
      run: `comment_url=$(gh pr comment "$PR_NUMBER" --body "$BODY" --repo "\$GITHUB_REPOSITORY" 2>&1)
comment_id=$(echo "$comment_url" | grep -oE '[0-9]+$' || echo "")
echo "comment_id=$comment_id" >> \$GITHUB_OUTPUT`,
      outputs: ["comment_id"] as const,
    }),
    // Step 3: Extract linked issue
    new ExtendedStep({
      id: "issue",
      name: "gh pr view (linked issue)",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        PR_NUMBER: expressions.expn("github.event.pull_request.number"),
      },
      run: `pr_body=$(gh pr view "$PR_NUMBER" --repo "\$GITHUB_REPOSITORY" --json body --jq '.body')

# Extract issue number from PR body (Fixes #123 pattern)
issue_number=$(echo "$pr_body" | grep -oE '(Fixes|Closes|Resolves) #[0-9]+' | head -1 | grep -oE '[0-9]+' || echo "")

if [[ -n "$issue_number" ]]; then
  echo "has_issue=true" >> \$GITHUB_OUTPUT
  echo "issue_number=$issue_number" >> \$GITHUB_OUTPUT

  # Fetch the linked issue body
  issue_body=$(gh issue view "$issue_number" --repo "\$GITHUB_REPOSITORY" --json body --jq '.body')
  {
    echo 'issue_body<<EOF'
    echo "$issue_body"
    echo 'EOF'
  } >> \$GITHUB_OUTPUT
else
  echo "has_issue=false" >> \$GITHUB_OUTPUT
  echo "issue_number=" >> \$GITHUB_OUTPUT
  {
    echo 'issue_body<<EOF'
    echo ''
    echo 'EOF'
  } >> \$GITHUB_OUTPUT
fi`,
      outputs: ["has_issue", "issue_number", "issue_body"] as const,
    }),
  ] as const,
  outputs: (steps) => ({
    pr_branch: expressions.expn("github.event.pull_request.head.ref"),
    pr_number: expressions.expn("github.event.pull_request.number"),
    is_draft: expressions.expn("github.event.pull_request.draft"),
    issue_number: steps.issue.outputs.issue_number,
    issue_body: steps.issue.outputs.issue_body,
    has_issue: steps.issue.outputs.has_issue,
    bot_comment_id: steps.bot_comment.outputs.comment_id,
  }),
});

// Request update project job
const requestUpdateProjectJob = new NormalJob("request-update-project", {
  needs: ["request-setup"],
  if: "needs.request-setup.outputs.has_issue == 'true'",
  "runs-on": "ubuntu-latest",
});

requestUpdateProjectJob.addSteps([
  ghApiUpdateProjectStatus({
    GH_TOKEN: expressions.expn("secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN"),
    ISSUE_NUMBER: expressions.expn("needs.request-setup.outputs.issue_number"),
    TARGET_STATUS: "In review",
  }),
]);

// Review prompt
const reviewPrompt = `You are reviewing PR #${expressions.expn("needs.request-setup.outputs.pr_number")} on behalf of nopo-bot.

nopo-bot was requested as a reviewer, which triggers this automated review.
You (claude[bot]) will perform the actual review and submit it.

${expressions.expn("needs.request-setup.outputs.has_issue == 'true' && format('## Linked Issue #{0}\n\n{1}\n\n## Validation\n- CHECK ALL TODO ITEMS in the issue are addressed\n- VERIFY code follows CLAUDE.md guidelines\n- ENSURE tests cover the requirements\n\n', needs.request-setup.outputs.issue_number, needs.request-setup.outputs.issue_body) || '## No Linked Issue\nPerforming standard code review.\n\n'")}
## Step 1: View the Changes

You are already checked out on the PR branch. To see changes:
\`\`\`bash
git fetch origin main
git diff origin/main...HEAD           # Full diff
git diff origin/main...HEAD --stat    # Summary of changed files
\`\`\`

## Step 2: Check Existing Review Comments

Check for existing review comments using:
\`\`\`bash
gh pr view ${expressions.expn("needs.request-setup.outputs.pr_number")} --comments
\`\`\`

For unresolved comment threads, decide if they should be resolved:
- If the conversation is COMPLETE: Note it can be resolved
- If changes were requested and made: Verify the fix
- If more discussion needed: Leave unresolved

## Step 3: Review the Code

Read the changed files and perform a thorough review:
- Code quality and best practices
- Potential bugs or edge cases
- Test coverage adequacy
- Security considerations

### CRITICAL: Edge Case Testing

Don't just check if todos are addressed - verify the LOGIC is correct:

1. **Trace through with examples**: Pick 2-3 realistic inputs and mentally
   trace the code path. For example:
   - What happens with empty input?
   - What happens with the most common case?
   - What happens at boundaries (first item, last item, max values)?

2. **Test conflicting requirements**: If the feature has multiple options
   (e.g., flags, filters), what happens when they interact?

3. **Run the code if possible**: Use the CLI or test commands to verify
   the feature actually works as intended, not just that it compiles.

4. **Check for design flaws**: Does the implementation order of operations
   make sense? Are filters applied at the right time?

If you find a logic bug, request changes with a specific example showing
the incorrect behavior.

## Step 4: Submit Your Review

Submit your review using \`gh pr review ${expressions.expn("needs.request-setup.outputs.pr_number")}\` with ONE of:
- \`--approve\` if ALL requirements met and code is good
- \`--request-changes -b "reason"\` if changes are needed
- \`--comment -b "feedback"\` if you have questions but no blocking issues

IMPORTANT:
- You may APPROVE but must NOT merge
- A human will make the final merge decision`;

// Request review job
const requestReviewJob = new NormalJob("request-review", {
  needs: ["request-setup", "request-update-project"],
  if: "always() && needs.request-setup.result == 'success'",
  "runs-on": "ubuntu-latest",
});

requestReviewJob.addSteps([
  // Step 1: Checkout PR branch
  new Step({
    uses: "actions/checkout@v4",
    with: {
      ref: expressions.expn("needs.request-setup.outputs.pr_branch"),
      "fetch-depth": 0,
    },
  }),
  // Step 2: Run Claude for review
  new Step({
    uses: "anthropics/claude-code-action@v1",
    with: {
      claude_code_oauth_token: expressions.secret("CLAUDE_CODE_OAUTH_TOKEN"),
      settings: ".claude/settings.json",
      prompt: reviewPrompt,
      claude_args: "--model claude-opus-4-5-20251101 --max-turns 50",
    },
    env: {
      GITHUB_TOKEN: expressions.secret("GITHUB_TOKEN"),
    },
  }),
  // Step 3: Add reaction on completion
  {
    ...ghApiAddReaction({
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      COMMENT_ID: expressions.expn("needs.request-setup.outputs.bot_comment_id"),
      REACTION: "rocket",
    }),
    if: "success()",
  },
  {
    ...ghApiAddReaction({
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      COMMENT_ID: expressions.expn("needs.request-setup.outputs.bot_comment_id"),
      REACTION: "eyes",
    }),
    if: "failure()",
  },
  // Step 4: Remove nopo-bot from requested reviewers
  {
    ...ghPrEditRemoveReviewer({
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      PR_NUMBER: expressions.expn("needs.request-setup.outputs.pr_number"),
      REVIEWERS: "nopo-bot",
    }),
    if: "always()",
  },
]);

// =============================================================================
// REVIEW RESPONSE JOBS
// =============================================================================

// Response process prompt
const responseProcessPrompt = `You just submitted a review on PR #${expressions.expn("github.event.pull_request.number")}.

Your review state: ${expressions.expn("github.event.review.state")}
Your review body: ${expressions.expn("github.event.review.body")}

## Step 1: Get Your Review Comments

Fetch the comments from your review:
\`\`\`
gh api /repos/${expressions.expn("github.repository")}/pulls/${expressions.expn("github.event.pull_request.number")}/comments
\`\`\`

Filter for comments from your review (review_id: ${expressions.expn("github.event.review.id")}).

## Step 2: Process Each Comment

For each comment you made:

### If it's a CHANGE REQUEST:
1. Make the requested change to the code
2. Commit with a clear message referencing the comment
3. Reply to the comment noting the fix

### If it's a QUESTION:
- Questions will be answered by the PR author
- No action needed now - wait for response

## Step 3: Finalize

After processing all comments, check if you made any commits:

### If you made commits (code changes):
Push the changes:
\`\`\`
git push origin ${expressions.expn("github.event.pull_request.head.ref")}
\`\`\`
The push will automatically convert PR to draft and trigger CI.
CI-pass will mark it ready and re-request nopo-bot as reviewer when CI is green.

### If you made NO commits (only discussion/questions):
Post a comment summarizing your analysis, then re-request nopo-bot as reviewer:
\`\`\`
gh pr comment ${expressions.expn("github.event.pull_request.number")} --body "## Review Response Summary

<your analysis of the review comments and what action was taken or why no action was needed>

Re-requesting review to continue the loop."

gh pr edit ${expressions.expn("github.event.pull_request.number")} --add-reviewer "nopo-bot"
\`\`\`

IMPORTANT:
- ALWAYS post a comment with your findings - never leave the PR without feedback
- Make atomic commits for each change
- Reference the comment in each commit message
- Follow CLAUDE.md guidelines for all code changes`;

// Response process job
const responseProcessJob = new NormalJob("response-process", {
  if: `github.event_name == 'pull_request_review' &&
github.event.review.user.login == 'claude[bot]' &&
github.event.pull_request.draft == false &&
(github.event.review.state == 'CHANGES_REQUESTED' || github.event.review.state == 'COMMENTED')`,
  "runs-on": "ubuntu-latest",
});

responseProcessJob.addSteps([
  // Step 1: Checkout PR branch
  new Step({
    uses: "actions/checkout@v4",
    with: {
      ref: expressions.expn("github.event.pull_request.head.ref"),
      "fetch-depth": 0,
    },
  }),
  // Step 2: Configure Git
  gitConfig({
    USER_NAME: "Claude Bot",
    USER_EMAIL: "claude-bot@anthropic.com",
  }),
  // Step 3: Run Claude to process review
  new Step({
    uses: "anthropics/claude-code-action@v1",
    with: {
      claude_code_oauth_token: expressions.secret("CLAUDE_CODE_OAUTH_TOKEN"),
      settings: ".claude/settings.json",
      prompt: responseProcessPrompt,
      claude_args: "--model claude-opus-4-5-20251101 --max-turns 50",
    },
    env: {
      GITHUB_TOKEN: expressions.secret("GITHUB_TOKEN"),
    },
  }),
]);

// =============================================================================
// HUMAN REVIEW RESPONSE JOB
// =============================================================================

// Human review response prompt
const humanReviewResponsePrompt = `A human reviewer (@${expressions.expn("github.event.review.user.login")}) submitted a review on PR #${expressions.expn("github.event.pull_request.number")}.

Review state: ${expressions.expn("github.event.review.state")}
Review body: ${expressions.expn("github.event.review.body")}

## Step 1: Get the Review Comments

Fetch comments from this review:
\`\`\`
gh api /repos/${expressions.expn("github.repository")}/pulls/${expressions.expn("github.event.pull_request.number")}/comments
\`\`\`

Filter for comments from review_id: ${expressions.expn("github.event.review.id")}

## Step 2: Process the Feedback

**For CHANGES_REQUESTED reviews:**
- Make each requested change to the code
- Commit with a clear message referencing what was fixed
- Reply to each comment noting the fix

**For COMMENTED reviews (questions):**
- Answer each question with a reply comment
- If a question implies a needed change, make it

## Step 3: Finalize

After processing all feedback:

### If you made commits (code changes):
Push the changes:
\`\`\`
git push origin ${expressions.expn("github.event.pull_request.head.ref")}
\`\`\`
The push will convert PR to draft and trigger CI.

### If you only answered questions (no commits):
Post a summary comment, then re-request nopo-bot for the next review cycle:
\`\`\`
gh pr edit ${expressions.expn("github.event.pull_request.number")} --add-reviewer "nopo-bot"
\`\`\`

IMPORTANT:
- Address ALL feedback from the human reviewer
- Make atomic commits for each change
- Follow CLAUDE.md guidelines`;

// Human review response job
const humanReviewResponseJob = new NormalJob("human-review-response", {
  if: `github.event_name == 'pull_request_review' &&
github.event.review.user.login != 'claude[bot]' &&
github.event.pull_request.draft == false &&
(github.event.review.state == 'CHANGES_REQUESTED' || github.event.review.state == 'COMMENTED')`,
  "runs-on": "ubuntu-latest",
});

humanReviewResponseJob.addSteps([
  // Step 1: Check if this is a Claude PR
  ghPrViewCheckClaude("check_author", {
    GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
    PR_NUMBER: expressions.expn("github.event.pull_request.number"),
  }),
  // Step 2: Checkout PR branch (only for Claude PRs)
  new Step({
    uses: "actions/checkout@v4",
    if: "steps.check_author.outputs.is_claude_pr == 'true'",
    with: {
      ref: expressions.expn("github.event.pull_request.head.ref"),
      "fetch-depth": 0,
    },
  }),
  // Step 3: Configure Git (only for Claude PRs)
  {
    ...gitConfig({
      USER_NAME: "Claude Bot",
      USER_EMAIL: "claude-bot@anthropic.com",
    }),
    if: "steps.check_author.outputs.is_claude_pr == 'true'",
  },
  // Step 4: Run Claude to respond (only for Claude PRs)
  new Step({
    uses: "anthropics/claude-code-action@v1",
    if: "steps.check_author.outputs.is_claude_pr == 'true'",
    with: {
      claude_code_oauth_token: expressions.secret("CLAUDE_CODE_OAUTH_TOKEN"),
      settings: ".claude/settings.json",
      prompt: humanReviewResponsePrompt,
      claude_args: "--model claude-opus-4-5-20251101 --max-turns 50",
    },
    env: {
      GITHUB_TOKEN: expressions.secret("GITHUB_TOKEN"),
    },
  }),
]);

// =============================================================================
// MAIN WORKFLOW
// =============================================================================

export const claudeReviewLoopWorkflow = new Workflow("claude-review-loop", {
  name: "Claude Review Loop",
  on: {
    pull_request: {
      types: ["review_requested"],
    },
    pull_request_review: {
      types: ["submitted"],
    },
    workflow_dispatch: {
      inputs: {
        pr_number: {
          description: "PR number to review",
          required: true,
          type: "string",
        },
        action: {
          description: "Action to simulate",
          required: true,
          type: "choice",
          options: ["review", "respond"],
        },
      },
    },
  },
  // CRITICAL: This concurrency group MUST match push-convert-to-draft in claude-ci-loop.yml
  // The shared group ensures pushes cancel in-flight review workflows.
  // - Push uses cancel-in-progress: true (cancels reviews)
  // - Review loop uses cancel-in-progress: false (queues, doesn't cancel itself)
  // This prevents race conditions where review acts on stale code.
  concurrency: {
    group: `claude-review-${expressions.expn("github.event.pull_request.head.ref")}`,
    "cancel-in-progress": false,
  },
  permissions: claudeReviewPermissions,
  defaults: defaultDefaults,
});

claudeReviewLoopWorkflow.addJobs([
  requestSetupJob,
  requestUpdateProjectJob,
  requestReviewJob,
  responseProcessJob,
  humanReviewResponseJob,
]);
