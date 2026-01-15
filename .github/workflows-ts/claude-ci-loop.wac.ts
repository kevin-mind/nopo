import { Workflow, expressions, echoKeyValue, dedentString } from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./lib/enhanced-step";
import { ExtendedNormalJob, needs } from "./lib/enhanced-job";
import { claudeCIPermissions, defaultDefaults } from "./lib/patterns";
import {
  ghPrList,
  ghPrReady,
  ghPrReadyUndo,
  ghPrEditAddReviewer,
  ghPrEditAddLabel,
  ghApiCountComments,
  ghApiUpdateProjectStatus,
} from "./lib/cli/gh";
import { gitConfig } from "./lib/cli/git";
import { loadPrompt } from "./lib/prompts";
import { checkoutStep, prViewExtendedStep } from "./lib/steps";

// =============================================================================
// PUSH JOBS
// =============================================================================

// Push convert to draft job
const pushConvertToDraftJob = new ExtendedNormalJob("push-convert-to-draft", {
  if: `github.event_name == 'push' &&
!startsWith(github.ref_name, 'gh-readonly-queue/')`,
  "runs-on": "ubuntu-latest",
  concurrency: {
    group: `claude-review-${expressions.expn("github.ref_name")}`,
    "cancel-in-progress": true,
  },
  steps: () => {
    const getPrStep = ghPrList("get_pr", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      HEAD_BRANCH: expressions.expn("github.ref_name"),
    });
    return [
      // Step 1: Find PR for this branch
      getPrStep,
      // Step 2: Convert to draft if PR exists and is ready
      ghPrReadyUndo("convert_to_draft", {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        PR_NUMBER: expressions.expn(getPrStep.outputs.number),
      }, {
        if: `${getPrStep.outputs.found} == 'true' && ${getPrStep.outputs.is_draft} == 'false'`,
      }),
    ];
  },
});

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
      run: dedentString(`
        if [[ -n "$INPUT_CONCLUSION" ]]; then
          ${echoKeyValue.toGithubOutput("conclusion", "$INPUT_CONCLUSION")}
        else
          ${echoKeyValue.toGithubOutput("conclusion", "$EVENT_CONCLUSION")}
        fi
      `),
      outputs: ["conclusion"],
    }),
    // Step 2: Get PR details (supports both HEAD_BRANCH and PR_NUMBER lookup)
    prViewExtendedStep("check", {
      gh_token: expressions.secret("GITHUB_TOKEN"),
      head_branch: expressions.expn("github.event.workflow_run.head_branch"),
      pr_number: expressions.expn("inputs.pr_number"),
    }),
  ],
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
const failureConvertToDraftJob = new ExtendedNormalJob("failure-convert-to-draft", {
  needs: ["check-pr"],
  if: `(github.event.workflow_run.conclusion == 'failure' || ${needs(checkPRJob).outputs.conclusion} == 'failure') &&
${needs(checkPRJob).outputs.has_pr} == 'true' &&
${needs(checkPRJob).outputs.is_claude_pr} == 'true' &&
${needs(checkPRJob).outputs.is_draft} == 'false'`,
  "runs-on": "ubuntu-latest",
  steps: [
    ghPrReadyUndo("convert_to_draft", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      PR_NUMBER: expressions.expn(needs(checkPRJob).outputs.pr_number),
    }),
    new ExtendedStep({
      id: "log_conversion",
      name: "Log conversion",
      run: `echo "Converted PR #${expressions.expn(needs(checkPRJob).outputs.pr_number)} to draft due to CI failure"`,
    }),
  ],
});

// CI failure fix prompt
const ciFailureFixPrompt = loadPrompt("ci-fix.txt", {
  PR_NUMBER: expressions.expn(needs(checkPRJob).outputs.pr_number),
  HEAD_BRANCH: expressions.expn(needs(checkPRJob).outputs.pr_head_branch),
});

// Failure fix and push job
const failureFixAndPushJob = new ExtendedNormalJob("failure-fix-and-push", {
  needs: ["check-pr", "failure-convert-to-draft"],
  if: `(github.event.workflow_run.conclusion == 'failure' || ${needs(checkPRJob).outputs.conclusion} == 'failure') &&
(needs.failure-convert-to-draft.result == 'success' || needs.failure-convert-to-draft.result == 'skipped') &&
${needs(checkPRJob).outputs.has_pr} == 'true' &&
${needs(checkPRJob).outputs.is_claude_pr} == 'true'`,
  "runs-on": "ubuntu-latest",
  steps: () => {
    const countCommentsStep = ghApiCountComments("count_comments", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      PR_NUMBER: expressions.expn(needs(checkPRJob).outputs.pr_number),
      USER_LOGIN: "claude[bot]",
    });

    const commentCountStep = new ExtendedStep({
      id: "check_limit",
      name: "Check comment limit",
      env: {
        COMMENT_COUNT: expressions.expn(countCommentsStep.outputs.count),
        MAX_COMMENTS: "50",
      },
      run: dedentString(`
        if [[ "$COMMENT_COUNT" -ge "$MAX_COMMENTS" ]]; then
          ${echoKeyValue.toGithubOutput("exceeded", "true")}
          echo "Claude has made $COMMENT_COUNT comments (max: $MAX_COMMENTS). Stopping to prevent infinite loop."
        else
          ${echoKeyValue.toGithubOutput("exceeded", "false")}
        fi
      `),
      outputs: ["exceeded"],
    });

    return [
      // Step 1: Count Claude's previous comments (circuit breaker)
      countCommentsStep,
      // Step 2: Check comment limit
      commentCountStep,
      // Step 3: Checkout the PR branch
      checkoutStep("checkout", {
        if: `${commentCountStep.outputs.exceeded} == 'false'`,
        ref: expressions.expn(needs(checkPRJob).outputs.pr_head_branch),
        fetchDepth: 0,
      }),
      // Step 4: Configure Git
      gitConfig("git_config", {
        USER_NAME: "Claude Bot",
        USER_EMAIL: "claude-bot@anthropic.com",
      }, {
        if: `${commentCountStep.outputs.exceeded} == 'false'`,
      }),
      // Step 5: Run Claude to fix the issue
      new ExtendedStep({
        id: "claude_fix",
        if: `${commentCountStep.outputs.exceeded} == 'false'`,
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
    ];
  },
});

// CI failure suggest fixes prompt
const ciFailureSuggestFixesPrompt = loadPrompt("ci-suggest.txt", {
  PR_NUMBER: expressions.expn(needs(checkPRJob).outputs.pr_number),
  HEAD_BRANCH: expressions.expn(needs(checkPRJob).outputs.pr_head_branch),
});

// Failure suggest fixes job (for human PRs)
const failureSuggestFixesJob = new ExtendedNormalJob("failure-suggest-fixes", {
  needs: ["check-pr"],
  if: `(github.event.workflow_run.conclusion == 'failure' || ${needs(checkPRJob).outputs.conclusion} == 'failure') &&
${needs(checkPRJob).outputs.has_pr} == 'true' &&
${needs(checkPRJob).outputs.is_claude_pr} == 'false'`,
  "runs-on": "ubuntu-latest",
  steps: [
    checkoutStep("checkout", {
      ref: expressions.expn("needs.check-pr.outputs.pr_head_branch"),
      fetchDepth: 0,
    }),
    new ExtendedStep({
      id: "claude_suggest",
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
  ],
});

// =============================================================================
// CI SUCCESS JOBS
// =============================================================================

// Success check comments job
const successCheckCommentsJob = new ExtendedNormalJob("success-check-comments", {
  needs: ["check-pr"],
  if: `(github.event.workflow_run.conclusion == 'success' || ${needs(checkPRJob).outputs.conclusion} == 'success') &&
${needs(checkPRJob).outputs.has_pr} == 'true'`,
  "runs-on": "ubuntu-latest",
  steps: () => {
    // Step 1: Check for unresolved comments via GraphQL
    const commentsStep = new ExtendedStep({
      id: "comments",
      name: "gh api graphql (unresolved comments)",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        PR_NUMBER: expressions.expn(needs(checkPRJob).outputs.pr_number),
      },
      run: dedentString(`
        repo_name="\${GITHUB_REPOSITORY#*/}"
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
        ${echoKeyValue.toGithubOutput("unresolved_count", "$unresolved_count")}
        ${echoKeyValue.toGithubOutput("has_unresolved", '$([[ "$unresolved_count" -gt 0 ]] && echo "true" || echo "false")')}
      `),
      outputs: ["has_unresolved", "unresolved_count"],
    })
    
    return [
      commentsStep,
      // Step 2: Comment if there are unresolved threads
      new ExtendedStep({
        id: "notify",
        name: "gh pr comment",
        if: `${commentsStep.outputs.has_unresolved} == 'true'`,
        env: {
          GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
          PR_NUMBER: expressions.expn(needs(checkPRJob).outputs.pr_number),
          BODY: dedentString(`
            ⏸️ **CI passed but not moving to Review**

            There are **${expressions.expn(commentsStep.outputs.unresolved_count)} unresolved comment thread(s)** on this PR.

            Please resolve all comments before the PR can move to Review status.
          `),
        },
        run: dedentString(`
          comment_url=$(gh pr comment "$PR_NUMBER" --body "$BODY" --repo "\$GITHUB_REPOSITORY" 2>&1)
          comment_id=$(echo "$comment_url" | grep -oE '[0-9]+$' || echo "")
          ${echoKeyValue.toGithubOutput("comment_id", "$comment_id")}
        `),
      }),
    ];
  },
  outputs: (steps) => ({
    has_unresolved: steps.comments.outputs.has_unresolved,
    unresolved_count: steps.comments.outputs.unresolved_count,
  }),
});

// Success update project job
const successUpdateProjectJob = new ExtendedNormalJob("success-update-project", {
  needs: ["check-pr", "success-check-comments"],
  if: `(github.event.workflow_run.conclusion == 'success' || ${needs(checkPRJob).outputs.conclusion} == 'success') &&
${needs(checkPRJob).outputs.has_issue} == 'true' &&
${needs(successCheckCommentsJob).outputs.has_unresolved} != 'true'`,
  "runs-on": "ubuntu-latest",
  steps: [
    ghApiUpdateProjectStatus("update_project", {
      GH_TOKEN: expressions.expn("secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN"),
      ISSUE_NUMBER: expressions.expn(needs(checkPRJob).outputs.issue_number),
      TARGET_STATUS: "In review",
    }),
  ],
});

// Success ready for review job
const successReadyForReviewJob = new ExtendedNormalJob("success-ready-for-review", {
  needs: ["check-pr", "success-check-comments", "success-update-project"],
  if: `always() &&
(github.event.workflow_run.conclusion == 'success' || ${needs(checkPRJob).outputs.conclusion} == 'success') &&
${needs(checkPRJob).outputs.has_pr} == 'true' &&
${needs(successCheckCommentsJob).outputs.has_unresolved} != 'true'`,
  "runs-on": "ubuntu-latest",
  steps: [
    // Step 1: Mark PR as ready
    ghPrReady("mark_ready", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      PR_NUMBER: expressions.expn(needs(checkPRJob).outputs.pr_number),
    }),
    // Step 2: Add review-ready label
    ghPrEditAddLabel("add_label", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      PR_NUMBER: expressions.expn(needs(checkPRJob).outputs.pr_number),
      LABEL: "review-ready",
    }),
    // Step 3: Request nopo-bot as reviewer
    ghPrEditAddReviewer("request_reviewer", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      PR_NUMBER: expressions.expn(needs(checkPRJob).outputs.pr_number),
      REVIEWERS: "nopo-bot",
    }),
  ],
});

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
