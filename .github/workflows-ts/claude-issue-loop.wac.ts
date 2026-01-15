import {
  Workflow,
  expressions,
  echoKeyValue,
  dedentString,
} from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./lib/enhanced-step";
import { ExtendedNormalJob } from "./lib/enhanced-job";
import { checkoutStep } from "./lib/steps";
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
  parseTriageOutput,
  ghIssueEditAddLabel,
  ghApplyTopicLabels,
  ghApiGetProjectItem,
  ghApiUpdateProjectPriority,
  ghApiUpdateProjectSize,
  ghApiUpdateProjectEstimate,
  heredocOutput,
} from "./lib/cli/gh";
import { gitConfig, gitCheckoutBranchWithDiff } from "./lib/cli/git";
import { loadPrompt } from "./lib/prompts";

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
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        ISSUE_NUMBER: expressions.expn(
          "github.event.issue.number || github.event.inputs.issue_number"
        ),
      },
      run: dedentString(`
        repo_name="\${GITHUB_REPOSITORY#*/}"
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
          ${echoKeyValue.toGithubOutput("is_sub_issue", "false")}
          ${echoKeyValue.toGithubOutput("should_triage", "false")}
          ${echoKeyValue.toGithubOutput("issue_title", "")}
          ${heredocOutput("issue_body", "echo ''")}
          exit 0
        fi

        parent=$(echo "$issue" | jq -r '.parent.number // empty')
        title=$(echo "$issue" | jq -r '.title')
        body=$(echo "$issue" | jq -r '.body // ""')

        if [[ -n "$parent" ]]; then
          ${echoKeyValue.toGithubOutput("is_sub_issue", "true")}
          ${echoKeyValue.toGithubOutput("should_triage", "false")}
        else
          ${echoKeyValue.toGithubOutput("is_sub_issue", "false")}
          ${echoKeyValue.toGithubOutput("should_triage", "true")}
        fi

        ${echoKeyValue.toGithubOutput("issue_title", "$title")}
        ${echoKeyValue.toGithubOutput("issue_number", "$ISSUE_NUMBER")}
        ${heredocOutput("issue_body", 'echo "$body"')}
      `),
      outputs: ["should_triage", "issue_number", "issue_title", "issue_body", "is_sub_issue"],
    }),
  ],
  outputs: (steps) => ({
    should_triage: steps.check.outputs.should_triage,
    issue_number: steps.check.outputs.issue_number,
    issue_title: steps.check.outputs.issue_title,
    issue_body: steps.check.outputs.issue_body,
  }),
});

// Triage prompt
const triagePrompt = loadPrompt("triage.txt", {
  ISSUE_NUMBER: expressions.expn("needs.triage-check.outputs.issue_number"),
  ISSUE_TITLE: expressions.expn("needs.triage-check.outputs.issue_title"),
  ISSUE_BODY: expressions.expn("needs.triage-check.outputs.issue_body"),
});

// Triage job
const triageJob = new ExtendedNormalJob("triage", {
  needs: ["triage-check"],
  "runs-on": "ubuntu-latest",
  if: "needs.triage-check.outputs.should_triage == 'true'",
  concurrency: {
    group: `claude-triage-${expressions.expn("needs.triage-check.outputs.issue_number")}`,
    "cancel-in-progress": true,
  },
  steps: [
    checkoutStep("checkout"),
    // Step 1: Post status comment
    ghIssueComment("bot_comment", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      ISSUE_NUMBER: expressions.expn("needs.triage-check.outputs.issue_number"),
      BODY: `👀 **nopo-bot** is triaging this issue...\n\n[View workflow run](${expressions.expn("github.server_url")}/${expressions.expn("github.repository")}/actions/runs/${expressions.expn("github.run_id")})`,
    }),
    // Step 2: Run Claude for triage
    new ExtendedStep({
      id: "claude_triage",
      uses: "anthropics/claude-code-action@v1",
      with: {
        claude_code_oauth_token: expressions.secret("CLAUDE_CODE_OAUTH_TOKEN"),
        settings: ".claude/settings.json",
        prompt: triagePrompt,
        claude_args: "--model claude-opus-4-5-20251101 --max-turns 50",
      },
      env: {
        GITHUB_TOKEN: expressions.secret("GITHUB_TOKEN"),
      },
    }),
    // Step 3: Parse triage output JSON
    parseTriageOutput("parse"),
    // Step 4: Apply labels (only if output exists)
    ghIssueEditAddLabel("apply_labels", {
      GH_TOKEN: expressions.expn("secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN"),
      ISSUE_NUMBER: expressions.expn("needs.triage-check.outputs.issue_number"),
      LABELS: expressions.expn("steps.parse.outputs.labels"),
    }, {
      if: "steps.parse.outputs.has_output == 'true'",
    }),
    // Step 5: Create and apply topic labels
    ghApplyTopicLabels("apply_topics", {
      GH_TOKEN: expressions.expn("secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN"),
      ISSUE_NUMBER: expressions.expn("needs.triage-check.outputs.issue_number"),
      TOPICS: expressions.expn("steps.parse.outputs.topics"),
    }, {
      if: "steps.parse.outputs.has_output == 'true' && steps.parse.outputs.topics != ''",
    }),
    // Step 6: Get project item
    ghApiGetProjectItem("project", {
      GH_TOKEN: expressions.expn("secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN"),
      ISSUE_NUMBER: expressions.expn("needs.triage-check.outputs.issue_number"),
    }),
    // Step 7: Update priority
    ghApiUpdateProjectPriority("update_priority", {
      GH_TOKEN: expressions.expn("secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN"),
      PROJECT_ID: expressions.expn("steps.project.outputs.project_id"),
      ITEM_ID: expressions.expn("steps.project.outputs.item_id"),
      PRIORITY: expressions.expn("steps.parse.outputs.priority"),
    }, {
      if: "steps.project.outputs.has_project == 'true'",
    }),
    // Step 8: Update size
    ghApiUpdateProjectSize("update_size", {
      GH_TOKEN: expressions.expn("secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN"),
      PROJECT_ID: expressions.expn("steps.project.outputs.project_id"),
      ITEM_ID: expressions.expn("steps.project.outputs.item_id"),
      SIZE: expressions.expn("steps.parse.outputs.size"),
    }, {
      if: "steps.project.outputs.has_project == 'true'",
    }),
    // Step 9: Update estimate
    ghApiUpdateProjectEstimate("update_estimate", {
      GH_TOKEN: expressions.expn("secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN"),
      PROJECT_ID: expressions.expn("steps.project.outputs.project_id"),
      ITEM_ID: expressions.expn("steps.project.outputs.item_id"),
      ESTIMATE: expressions.expn("steps.parse.outputs.estimate"),
    }, {
      if: "steps.project.outputs.has_project == 'true'",
    }),
    // Step 10: Add reaction on completion
    ghApiAddReaction("reaction_success", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      COMMENT_ID: expressions.expn("steps.bot_comment.outputs.comment_id"),
      REACTION: "rocket",
    }, {
      if: "success()",
    }),
    ghApiAddReaction("reaction_failure", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      COMMENT_ID: expressions.expn("steps.bot_comment.outputs.comment_id"),
      REACTION: "eyes",
    }, {
      if: "failure()",
    }),
  ],
});

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
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        ISSUE_NUMBER: expressions.expn("github.event.issue.number"),
        LABEL: "triaged",
      },
      run: dedentString(`
        has_label=$(gh issue view "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --json labels --jq ".labels[].name" | grep -c "^$LABEL$" || true)
        ${echoKeyValue.toGithubOutput("has_label", '$([[ "$has_label" -gt 0 ]] && echo "true" || echo "false")')}
      `),
      outputs: ["has_label"],
    }),
    // Step 2: Check project status allows implementation
    new ExtendedStep({
      id: "check_status",
      name: "gh api graphql (check project status)",
      env: {
        GH_TOKEN: expressions.expn("secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN"),
        ISSUE_NUMBER: expressions.expn("github.event.issue.number"),
      },
      run: dedentString(`
        repo_name="\${GITHUB_REPOSITORY#*/}"
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

        ${echoKeyValue.toGithubOutput("status", "$status")}

        # Can implement if status is empty, Ready, or Backlog
        if [[ -z "$status" || "$status" == "Ready" || "$status" == "Backlog" ]]; then
          ${echoKeyValue.toGithubOutput("can_implement", "true")}
        else
          ${echoKeyValue.toGithubOutput("can_implement", "false")}
        fi
      `),
      outputs: ["status", "can_implement"],
    }),
    // Step 3: Get issue details with comments
    new ExtendedStep({
      id: "issue",
      name: "gh issue view (with comments)",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        ISSUE_NUMBER: expressions.expn("github.event.issue.number"),
      },
      run: dedentString(`
        issue=$(gh issue view "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --json title,body,labels,comments)
        ${echoKeyValue.toGithubOutput("title", '$(echo "$issue" | jq -r \'.title\')')}
        ${heredocOutput("body", 'echo "$issue" | jq -r \'.body\'')}
        ${echoKeyValue.toGithubOutput("labels", '$(echo "$issue" | jq -c \'[.labels[].name]\')')}
        ${heredocOutput("comments", 'echo "$issue" | jq -r \'.comments[] | "---\\nAuthor: \\(.author.login)\\n\\(.body)\\n"\'')}
      `),
      outputs: ["title", "body", "labels", "comments"],
    }),
    // Step 4: Post status comment
    new ExtendedStep({
      id: "bot_comment",
      name: "gh issue comment",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        ISSUE_NUMBER: expressions.expn("github.event.issue.number"),
        BODY: `👀 **nopo-bot** is implementing this issue...\n\n[View workflow run](${expressions.expn("github.server_url")}/${expressions.expn("github.repository")}/actions/runs/${expressions.expn("github.run_id")})`,
      },
      run: dedentString(`
        comment_url=$(gh issue comment "$ISSUE_NUMBER" --body "$BODY" --repo "$GITHUB_REPOSITORY" 2>&1)
        comment_id=$(echo "$comment_url" | grep -oE '[0-9]+$' || echo "")
        ${echoKeyValue.toGithubOutput("comment_id", "$comment_id")}
      `),
      outputs: ["comment_id"],
    }),
    // Step 5: Check if PR already exists
    new ExtendedStep({
      id: "check_pr",
      name: "gh pr list (for issue)",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        ISSUE_NUMBER: expressions.expn("github.event.issue.number"),
      },
      run: dedentString(`
        # Search for PRs that mention "Fixes #N" or "Closes #N"
        prs=$(gh pr list --repo "$GITHUB_REPOSITORY" --state open --json number,headRefName,url,body)

        # Find PR that references this issue
        pr=$(echo "$prs" | jq -r --arg issue "$ISSUE_NUMBER" '
          .[] | select(.body | test("(Fixes|Closes|Resolves) #" + $issue + "([^0-9]|$)"; "i"))
        ' | head -1)

        if [[ -n "$pr" && "$pr" != "null" ]]; then
          ${echoKeyValue.toGithubOutput("has_pr", "true")}
          ${echoKeyValue.toGithubOutput("pr_number", '$(echo "$pr" | jq -r \'.number\')')}
          ${echoKeyValue.toGithubOutput("pr_branch", '$(echo "$pr" | jq -r \'.headRefName\')')}
          ${echoKeyValue.toGithubOutput("pr_url", '$(echo "$pr" | jq -r \'.url\')')}
        else
          ${echoKeyValue.toGithubOutput("has_pr", "false")}
          ${echoKeyValue.toGithubOutput("pr_number", "")}
          ${echoKeyValue.toGithubOutput("pr_branch", "")}
          ${echoKeyValue.toGithubOutput("pr_url", "")}
        fi
      `),
      outputs: ["has_pr", "pr_number", "pr_branch", "pr_url"],
    }),
  ],
  outputs: (steps) => ({
    should_implement: "steps.check_pr.outputs.has_pr == 'false'",
    issue_title: "github.event.issue.title",
    issue_body: steps.issue.outputs.body,
    issue_comments: steps.issue.outputs.comments,
    bot_comment_id: steps.bot_comment.outputs.comment_id,
  }),
});

// Implement update project job
const implementUpdateProjectJob = new ExtendedNormalJob("implement-update-project", {
  needs: ["implement-check"],
  if: "needs.implement-check.outputs.should_implement == 'true'",
  "runs-on": "ubuntu-latest",
  steps: [
    ghApiUpdateProjectStatus("update_status", {
      GH_TOKEN: expressions.expn("secrets.PROJECT_TOKEN || secrets.GITHUB_TOKEN"),
      ISSUE_NUMBER: expressions.expn("github.event.issue.number"),
      TARGET_STATUS: "In progress",
    }),
  ],
});

// Implement prompt
const implementPrompt = loadPrompt("implement.txt", {
  ISSUE_NUMBER: expressions.expn("github.event.issue.number"),
  ISSUE_TITLE: expressions.expn("needs.implement-check.outputs.issue_title"),
  ISSUE_BODY: expressions.expn("needs.implement-check.outputs.issue_body"),
  BRANCH_NAME: expressions.expn("steps.branch.outputs.name"),
  EXISTING_BRANCH_SECTION: expressions.expn(
    `steps.branch.outputs.existing_branch == 'true' && format('
## ⚠️ EXISTING BRANCH - Previous work detected

This branch already has changes from a previous implementation attempt:
\\\`\\\`\\\`
{0}
\\\`\\\`\\\`

**CRITICAL**: Review what is already done. Do NOT re-implement completed work.
Start from the CURRENT state of the code and continue toward the goal.
If an edit fails because the text is not found, the change may already be applied.
', steps.branch.outputs.diff) || ''`
  ),
});

// Implement job
const implementJob = new ExtendedNormalJob("implement", {
  needs: ["implement-check", "implement-update-project"],
  if: "always() && needs.implement-check.outputs.should_implement == 'true'",
  "runs-on": "ubuntu-latest",
  steps: [
    // Step 1: Checkout with full history
    checkoutStep("checkout", { fetchDepth: 0 }),
    // Step 2: Configure Git
    gitConfig("git_config", {
      USER_NAME: "Claude Bot",
      USER_EMAIL: "claude-bot@anthropic.com",
    }),
    // Step 3: Create or checkout branch (with diff for existing)
    gitCheckoutBranchWithDiff("branch", {
      BRANCH_NAME: `claude/issue/${expressions.expn("github.event.issue.number")}`,
    }),
    // Step 4: Run Claude to implement
    new ExtendedStep({
      id: "claude_implement",
      uses: "anthropics/claude-code-action@v1",
      with: {
        claude_code_oauth_token: expressions.secret("CLAUDE_CODE_OAUTH_TOKEN"),
        github_token: expressions.secret("GITHUB_TOKEN"),
        assignee_trigger: "nopo-bot",
        settings: ".claude/settings.json",
        show_full_output: "true",
        prompt: implementPrompt,
        claude_args: "--model claude-opus-4-5-20251101 --max-turns 200",
      },
      env: {
        GITHUB_TOKEN: expressions.secret("GITHUB_TOKEN"),
      },
    }),
    // Step 5: Salvage partial progress on failure
    new ExtendedStep({
      id: "salvage",
      name: "Salvage partial progress",
      if: "failure()",
      env: {
        GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
        ISSUE_NUMBER: expressions.expn("github.event.issue.number"),
        BRANCH_NAME: expressions.expn("steps.branch.outputs.name"),
      },
      run: dedentString(`
        # Check if there are uncommitted changes
        if ! git diff --quiet HEAD 2>/dev/null; then
          git add -A
          git commit -m "WIP: Partial implementation progress

        Fixes #$ISSUE_NUMBER" || true
          git push origin "$BRANCH_NAME" || true

          # Create draft PR if it doesn't exist
          existing_pr=$(gh pr list --head "$BRANCH_NAME" --json number --jq '.[0].number')
          if [[ -z "$existing_pr" ]]; then
            gh pr create --draft --title "WIP: Implementation for #$ISSUE_NUMBER" \\
              --body "Fixes #$ISSUE_NUMBER

        **Note**: This is partial progress from an interrupted implementation." \\
              --reviewer nopo-bot || true
          fi
        fi
      `),
    }),
    // Step 6: Add reaction on completion
    ghApiAddReaction("reaction_success", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      COMMENT_ID: expressions.expn("needs.implement-check.outputs.bot_comment_id"),
      REACTION: "rocket",
    }, {
      if: "success()",
    }),
    ghApiAddReaction("reaction_failure", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      COMMENT_ID: expressions.expn("needs.implement-check.outputs.bot_comment_id"),
      REACTION: "eyes",
    }, {
      if: "failure()",
    }),
    // Step 7: Unassign nopo-bot on failure
    ghIssueEditRemoveAssignee("unassign", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      ISSUE_NUMBER: expressions.expn("github.event.issue.number"),
      ASSIGNEES: "nopo-bot",
    }, {
      if: "failure()",
    }),
  ],
});

// =============================================================================
// COMMENT JOBS
// =============================================================================

// Comment prompt
const commentPrompt = loadPrompt("comment.txt", {
  CONTEXT_TYPE: expressions.expn("steps.pr_context.outputs.is_pr == 'true' && 'PR' || 'issue'"),
  CONTEXT_DESCRIPTION: expressions.expn(
    "steps.pr_context.outputs.is_pr == 'true' && format('This is PR #{0} on branch `{1}`. You are checked out on the PR branch with the code changes.', github.event.issue.number, steps.pr_context.outputs.branch) || format('This is issue #{0}. You are checked out on main.', github.event.issue.number)"
  ),
  ISSUE_NUMBER: expressions.expn("github.event.issue.number"),
});

// Comment job
const commentJob = new ExtendedNormalJob("comment", {
  "runs-on": "ubuntu-latest",
  if: `(github.event_name == 'issue_comment' || github.event_name == 'pull_request_review_comment') &&
contains(github.event.comment.body, '@claude') &&
github.event.comment.user.type != 'Bot'`,
  steps: [
    // Step 1: Post status comment
    ghIssueComment("bot_comment", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      ISSUE_NUMBER: expressions.expn(
        "github.event.issue.number || github.event.pull_request.number"
      ),
      BODY: `👀 **nopo-bot** is responding to your request...\n\n[View workflow run](${expressions.expn("github.server_url")}/${expressions.expn("github.repository")}/actions/runs/${expressions.expn("github.run_id")})`,
    }),
    // Step 2: Count Claude's previous comments (circuit breaker)
    ghApiCountComments("count_comments", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      PR_NUMBER: expressions.expn(
        "github.event.issue.number || github.event.pull_request.number"
      ),
      USER_LOGIN: "claude[bot]",
    }),
    // Step 3: Check comment limit
    new ExtendedStep({
      id: "check_limit",
      name: "Check comment limit",
      env: {
        COMMENT_COUNT: expressions.expn("steps.count_comments.outputs.count"),
        MAX_COMMENTS: "50",
      },
      run: dedentString(`
        if [[ "$COMMENT_COUNT" -ge "$MAX_COMMENTS" ]]; then
          ${echoKeyValue.toGithubOutput("exceeded", "true")}
          echo "Claude has made $COMMENT_COUNT comments (max: $MAX_COMMENTS). Stopping."
        else
          ${echoKeyValue.toGithubOutput("exceeded", "false")}
        fi
      `),
    }),
    // Step 4: Get PR branch context
    ghPrViewBranch("pr_context", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      IS_PR: expressions.expn("github.event.issue.pull_request != ''"),
      PR_NUMBER: expressions.expn("github.event.issue.number"),
    }),
    // Step 5: Checkout
    checkoutStep("checkout", {
      if: "steps.check_limit.outputs.exceeded == 'false'",
      ref: expressions.expn("steps.pr_context.outputs.branch"),
      fetchDepth: 0,
    }),
    // Step 6: Run Claude
    new ExtendedStep({
      id: "claude_respond",
      if: "steps.check_limit.outputs.exceeded == 'false'",
      uses: "anthropics/claude-code-action@v1",
      with: {
        claude_code_oauth_token: expressions.secret("CLAUDE_CODE_OAUTH_TOKEN"),
        settings: ".claude/settings.json",
        trigger_phrase: "@claude",
        prompt: commentPrompt,
        claude_args: "--model claude-opus-4-5-20251101 --max-turns 100",
      },
      env: {
        GITHUB_TOKEN: expressions.secret("GITHUB_TOKEN"),
      },
    }),
    // Step 7: Add reaction on completion
    ghApiAddReaction("reaction_success", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      COMMENT_ID: expressions.expn("steps.bot_comment.outputs.comment_id"),
      REACTION: "rocket",
    }, {
      if: "success()",
    }),
    ghApiAddReaction("reaction_failure", {
      GH_TOKEN: expressions.secret("GITHUB_TOKEN"),
      COMMENT_ID: expressions.expn("steps.bot_comment.outputs.comment_id"),
      REACTION: "eyes",
    }, {
      if: "failure()",
    }),
  ],
});

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
