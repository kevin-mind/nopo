import {
  Workflow,
  expressions,
  echoKeyValue,
  dedentString,
} from "@github-actions-workflow-ts/lib";
import { heredocOutput } from "./lib/cli/gh";
import { loadPrompt } from "./lib/prompts";
import { ExtendedStep } from "./lib/enhanced-step";
import { ExtendedNormalJob } from "./lib/enhanced-job";
import { claudeReviewPermissions, defaultDefaults } from "./lib/patterns";
import { checkoutStep } from "./lib/steps";

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
      run: dedentString(`
        comment_url=$(gh pr comment "$PR_NUMBER" --body "$BODY" --repo "$GITHUB_REPOSITORY" 2>&1)
        comment_id=$(echo "$comment_url" | grep -oE '[0-9]+$' || echo "")
        ${echoKeyValue.toGithubOutput("comment_id", "$comment_id")}
      `),
      outputs: ["comment_id"],
    }),
    // Step 3: Extract linked issue
    new ExtendedStep({
      id: "issue",
      name: "gh pr view (linked issue)",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        PR_NUMBER: expressions.expn("github.event.pull_request.number"),
      },
      run: dedentString(`
        pr_body=$(gh pr view "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --json body --jq '.body')

        # Extract issue number from PR body (Fixes #123 pattern)
        issue_number=$(echo "$pr_body" | grep -oE '(Fixes|Closes|Resolves) #[0-9]+' | head -1 | grep -oE '[0-9]+' || echo "")

        if [[ -n "$issue_number" ]]; then
          ${echoKeyValue.toGithubOutput("has_issue", "true")}
          ${echoKeyValue.toGithubOutput("issue_number", "$issue_number")}

          # Fetch the linked issue body
          issue_body=$(gh issue view "$issue_number" --repo "$GITHUB_REPOSITORY" --json body --jq '.body')
          ${heredocOutput("issue_body", "$issue_body")}
        else
          ${echoKeyValue.toGithubOutput("has_issue", "false")}
          ${echoKeyValue.toGithubOutput("issue_number", "")}
          ${heredocOutput("issue_body", "")}
        fi
      `),
      outputs: ["has_issue", "issue_number", "issue_body"],
    }),
  ],
  outputs: (steps) => ({
    pr_branch: "github.event.pull_request.head.ref",
    pr_number: "github.event.pull_request.number",
    is_draft: "github.event.pull_request.draft",
    issue_number: steps.issue.outputs.issue_number,
    issue_body: steps.issue.outputs.issue_body,
    has_issue: steps.issue.outputs.has_issue,
    bot_comment_id: steps.bot_comment.outputs.comment_id,
  }),
});

// Request update project job
// GraphQL queries for finding and updating project items
const findItemQuery = `
  query($owner: String!, $repo: String!, $issue: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $issue) {
        projectItems(first: 10) {
          nodes {
            id
            project {
              id
              title
              field(name: "Status") {
                ... on ProjectV2SingleSelectField {
                  id
                  options { id name }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const updateMutation = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item { id }
    }
  }
`;

const requestUpdateProjectJob = new ExtendedNormalJob("request-update-project", {
  needs: ["request-setup"],
  if: "needs.request-setup.outputs.has_issue == 'true'",
  "runs-on": "ubuntu-latest",
  steps: [
    new ExtendedStep({
      id: "update_project_status",
      name: "gh api graphql (update project status)",
      env: {
        GH_TOKEN: expressions.expn("secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN"),
        ISSUE_NUMBER: expressions.expn("needs.request-setup.outputs.issue_number"),
        TARGET_STATUS: "In review",
      },
      run: dedentString(`
        repo_name="\${GITHUB_REPOSITORY#*/}"
        owner="\${GITHUB_REPOSITORY%/*}"

        # Find the project item
        result=$(gh api graphql -f query='${findItemQuery.trim()}' \\
          -F owner="$owner" \\
          -F repo="$repo_name" \\
          -F issue="$ISSUE_NUMBER" 2>/dev/null || echo "{}")

        # Extract project info
        item=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0] // empty')
        if [[ -z "$item" ]]; then
          echo "No project item found for issue #$ISSUE_NUMBER"
          exit 0
        fi

        item_id=$(echo "$item" | jq -r '.id')
        project_id=$(echo "$item" | jq -r '.project.id')
        field_id=$(echo "$item" | jq -r '.project.field.id')
        option_id=$(echo "$item" | jq -r --arg status "$TARGET_STATUS" '.project.field.options[] | select(.name == $status) | .id')

        if [[ -z "$option_id" ]]; then
          echo "Status '$TARGET_STATUS' not found in project"
          exit 0
        fi

        # Update the status
        gh api graphql -f query='${updateMutation.trim()}' \\
          -F projectId="$project_id" \\
          -F itemId="$item_id" \\
          -F fieldId="$field_id" \\
          -F optionId="$option_id"

        echo "Updated project status to '$TARGET_STATUS'"
`),
    }),
  ],
});

// Review prompt
const reviewPrompt = loadPrompt("review.txt", {
  PR_NUMBER: expressions.expn("needs.request-setup.outputs.pr_number"),
  ISSUE_SECTION: expressions.expn(
    "needs.request-setup.outputs.has_issue == 'true' && format('## Linked Issue #{0}\\n\\n{1}\\n\\n## Validation\\n- CHECK ALL TODO ITEMS in the issue are addressed\\n- VERIFY code follows CLAUDE.md guidelines\\n- ENSURE tests cover the requirements\\n\\n', needs.request-setup.outputs.issue_number, needs.request-setup.outputs.issue_body) || '## No Linked Issue\\nPerforming standard code review.\\n\\n'"
  ),
});

// Request review job
const requestReviewJob = new ExtendedNormalJob("request-review", {
  needs: ["request-setup", "request-update-project"],
  if: "always() && needs.request-setup.result == 'success'",
  "runs-on": "ubuntu-latest",
  steps: [
    // Step 1: Checkout PR branch
    checkoutStep("checkout", {
      ref: expressions.expn("needs.request-setup.outputs.pr_branch"),
      fetchDepth: 0,
    }),
    // Step 2: Run Claude for review
    new ExtendedStep({
      id: "claude_review",
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
    // Step 3: Add reaction on completion (success)
    new ExtendedStep({
      id: "reaction_success",
      name: "gh api (add reaction)",
      if: "success()",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        COMMENT_ID: expressions.expn("needs.request-setup.outputs.bot_comment_id"),
        REACTION: "rocket",
      },
      run: `gh api "repos/$GITHUB_REPOSITORY/issues/comments/$COMMENT_ID/reactions" -f content="$REACTION"`,
    }),
    // Step 3b: Add reaction on completion (failure)
    new ExtendedStep({
      id: "reaction_failure",
      name: "gh api (add reaction)",
      if: "failure()",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        COMMENT_ID: expressions.expn("needs.request-setup.outputs.bot_comment_id"),
        REACTION: "eyes",
      },
      run: `gh api "repos/$GITHUB_REPOSITORY/issues/comments/$COMMENT_ID/reactions" -f content="$REACTION"`,
    }),
    // Step 4: Remove nopo-bot from requested reviewers
    new ExtendedStep({
      id: "remove_reviewer",
      name: "gh pr edit --remove-reviewer",
      if: "always()",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        PR_NUMBER: expressions.expn("needs.request-setup.outputs.pr_number"),
        REVIEWERS: "nopo-bot",
      },
      run: `gh pr edit "$PR_NUMBER" --remove-reviewer "$REVIEWERS" --repo "$GITHUB_REPOSITORY" || true`,
    }),
  ],
});

// =============================================================================
// REVIEW RESPONSE JOBS
// =============================================================================

// Response process prompt
const responseProcessPrompt = loadPrompt("review-response.txt", {
  PR_NUMBER: expressions.expn("github.event.pull_request.number"),
  REVIEW_STATE: expressions.expn("github.event.review.state"),
  REVIEW_BODY: expressions.expn("github.event.review.body"),
  REPOSITORY: expressions.expn("github.repository"),
  REVIEW_ID: expressions.expn("github.event.review.id"),
  HEAD_REF: expressions.expn("github.event.pull_request.head.ref"),
});

// Response process job
const responseProcessJob = new ExtendedNormalJob("response-process", {
  if: `github.event_name == 'pull_request_review' &&
github.event.review.user.login == 'claude[bot]' &&
github.event.pull_request.draft == false &&
(github.event.review.state == 'CHANGES_REQUESTED' || github.event.review.state == 'COMMENTED')`,
  "runs-on": "ubuntu-latest",
  steps: [
    // Step 1: Checkout PR branch
    checkoutStep("checkout", {
      ref: expressions.expn("github.event.pull_request.head.ref"),
      fetchDepth: 0,
    }),
    // Step 2: Configure Git
    new ExtendedStep({
      id: "git_config",
      name: "git config",
      env: {
        USER_NAME: "Claude Bot",
        USER_EMAIL: "claude-bot@anthropic.com",
      },
      run: `git config --global user.name "$USER_NAME"
git config --global user.email "$USER_EMAIL"`,
    }),
    // Step 3: Run Claude to process review
    new ExtendedStep({
      id: "claude_response",
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
  ],
});

// =============================================================================
// HUMAN REVIEW RESPONSE JOB
// =============================================================================

// Human review response prompt
const humanReviewResponsePrompt = loadPrompt("human-review-response.txt", {
  REVIEWER_LOGIN: expressions.expn("github.event.review.user.login"),
  PR_NUMBER: expressions.expn("github.event.pull_request.number"),
  REVIEW_STATE: expressions.expn("github.event.review.state"),
  REVIEW_BODY: expressions.expn("github.event.review.body"),
  REPOSITORY: expressions.expn("github.repository"),
  REVIEW_ID: expressions.expn("github.event.review.id"),
  HEAD_REF: expressions.expn("github.event.pull_request.head.ref"),
});

// Human review response job
const humanReviewResponseJob = new ExtendedNormalJob("human-review-response", {
  if: `github.event_name == 'pull_request_review' &&
github.event.review.user.login != 'claude[bot]' &&
github.event.pull_request.draft == false &&
(github.event.review.state == 'CHANGES_REQUESTED' || github.event.review.state == 'COMMENTED')`,
  "runs-on": "ubuntu-latest",
  steps: [
    // Step 1: Check if this is a Claude PR
    new ExtendedStep({
      id: "check_author",
      name: "gh pr view (check claude)",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        PR_NUMBER: expressions.expn("github.event.pull_request.number"),
      },
      run: dedentString(`
        pr=$(gh pr view "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --json headRefName,author)
        author=$(echo "$pr" | jq -r '.author.login')
        head_branch=$(echo "$pr" | jq -r '.headRefName')

        is_claude_pr="false"
        if [[ "$author" == "claude[bot]" || "$head_branch" == claude/* ]]; then
          is_claude_pr="true"
        fi

        ${echoKeyValue.toGithubOutput("is_claude_pr", "$is_claude_pr")}
      `),
      outputs: ["is_claude_pr"],
    }),
    // Step 2: Checkout PR branch (only for Claude PRs)
    checkoutStep("checkout", {
      if: "steps.check_author.outputs.is_claude_pr == 'true'",
      ref: expressions.expn("github.event.pull_request.head.ref"),
      fetchDepth: 0,
    }),
    // Step 3: Configure Git (only for Claude PRs)
    new ExtendedStep({
      id: "git_config",
      name: "git config",
      if: "steps.check_author.outputs.is_claude_pr == 'true'",
      env: {
        USER_NAME: "Claude Bot",
        USER_EMAIL: "claude-bot@anthropic.com",
      },
      run: `git config --global user.name "$USER_NAME"
git config --global user.email "$USER_EMAIL"`,
    }),
    // Step 4: Run Claude to respond (only for Claude PRs)
    new ExtendedStep({
      id: "claude_human_response",
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
  ],
});

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
