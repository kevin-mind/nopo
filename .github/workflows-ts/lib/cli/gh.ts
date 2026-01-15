/**
 * Atomic GitHub CLI step generators.
 * Each function generates a Step that executes exactly ONE `gh` CLI command.
 *
 * Naming convention: gh<Subcommand> → gh <subcommand>
 * - ghPrList → gh pr list
 * - ghIssueEdit → gh issue edit
 * - ghApiGraphql → gh api graphql
 */

import { echoKeyValue, dedentString, type GeneratedWorkflowTypes } from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "../enhanced-step.js";

/** Optional step properties that can be added to any step (if, name override, etc.) */
export type StepProps = Omit<GeneratedWorkflowTypes.Step, 'id' | 'run' | 'uses' | 'env' | 'with'>;

/**
 * Helper for multi-line GitHub Actions outputs using heredoc syntax.
 * Use this when the value may contain newlines.
 */
export function toGithubOutputMultiline(key: string, valueExpr: string): string {
  return `${echoKeyValue.toGithubOutput(key, `"$(cat <<'EOF'\n\${${valueExpr}}\nEOF\n)"`)}`;
}

/**
 * Simpler multi-line output using heredoc for variables.
 */
export function heredocOutput(key: string, content: string): string {
  return `{
  echo '${key}<<EOF'
  ${content}
  echo 'EOF'
} >> $GITHUB_OUTPUT`;
}

// =============================================================================
// gh pr - Pull Request Commands
// =============================================================================

/**
 * gh pr list - List PRs matching criteria
 * @outputs number, is_draft, author, found, head_branch
 */
export function ghPrList(
  id: string,
  env: {
    GH_TOKEN: string;
    HEAD_BRANCH?: string;
    STATE?: string;
  },
  props?: StepProps,
) {
  const headFilter = env.HEAD_BRANCH ? '--head "$HEAD_BRANCH"' : "";
  const stateFilter = env.STATE ? '--state "$STATE"' : "";

  return new ExtendedStep({
    id,
    ...props,
    name: "gh pr list",
    env,
    run: dedentString(`
      pr=$(gh pr list --repo "$GITHUB_REPOSITORY" ${headFilter} ${stateFilter} --json number,isDraft,author,headRefName --jq '.[0]')
      ${echoKeyValue.toGithubOutput("number", '$(echo "$pr" | jq -r \'.number // empty\')')}
      ${echoKeyValue.toGithubOutput("is_draft", '$(echo "$pr" | jq -r \'.isDraft // empty\')')}
      ${echoKeyValue.toGithubOutput("author", '$(echo "$pr" | jq -r \'.author.login // empty\')')}
      ${echoKeyValue.toGithubOutput("head_branch", '$(echo "$pr" | jq -r \'.headRefName // empty\')')}
      ${echoKeyValue.toGithubOutput("found", '$([[ -n "$pr" && "$pr" != "null" ]] && echo "true" || echo "false")')}
    `),
    outputs: ["number", "is_draft", "author", "head_branch", "found"],
  });
}

/**
 * gh pr view - Get PR details
 * @outputs number, is_draft, author, head_branch, body
 */
export function ghPrView(
  id: string,
  env: {
    GH_TOKEN: string;
    PR_NUMBER: string;
  },
) {
  return new ExtendedStep({
    id,
    name: "gh pr view",
    env,
    run: dedentString(`
      pr=$(gh pr view "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --json number,isDraft,author,headRefName,body)
      ${echoKeyValue.toGithubOutput("number", '$(echo "$pr" | jq -r \'.number\')')}
      ${echoKeyValue.toGithubOutput("is_draft", '$(echo "$pr" | jq -r \'.isDraft\')')}
      ${echoKeyValue.toGithubOutput("author", '$(echo "$pr" | jq -r \'.author.login\')')}
      ${echoKeyValue.toGithubOutput("head_branch", '$(echo "$pr" | jq -r \'.headRefName\')')}
      ${heredocOutput("body", 'echo "$pr" | jq -r \'.body\'')}
    `),
    outputs: ["number", "is_draft", "author", "head_branch", "body"],
  });
}

/**
 * gh pr ready - Mark PR as ready for review
 * No outputs (action only)
 */
export function ghPrReady(id: string, env: { GH_TOKEN: string; PR_NUMBER: string }, props?: StepProps): ExtendedStep {
  return new ExtendedStep({
    id,
    ...props,
    name: "gh pr ready",
    env,
    run: `gh pr ready "$PR_NUMBER" --repo "$GITHUB_REPOSITORY"`,
  });
}

/**
 * gh pr ready --undo - Convert PR to draft
 * No outputs (action only)
 */
export function ghPrReadyUndo(id: string, env: {
  GH_TOKEN: string;
  PR_NUMBER: string;
}, props?: StepProps): ExtendedStep {
  return new ExtendedStep({
    id,
    ...props,
    name: "gh pr ready --undo",
    env,
    run: `gh pr ready "$PR_NUMBER" --undo --repo "$GITHUB_REPOSITORY"`,
  });
}

/**
 * gh pr edit --add-reviewer - Add reviewers to PR
 * No outputs (action only)
 */
export function ghPrEditAddReviewer(id: string, env: {
  GH_TOKEN: string;
  PR_NUMBER: string;
  REVIEWERS: string;
}, props?: StepProps): ExtendedStep {
  return new ExtendedStep({
    id,
    ...props,
    name: "gh pr edit --add-reviewer",
    env,
    run: `gh pr edit "$PR_NUMBER" --add-reviewer "$REVIEWERS" --repo "$GITHUB_REPOSITORY"`,
  });
}

/**
 * gh pr edit --add-label - Add label to PR
 * No outputs (action only)
 */
export function ghPrEditAddLabel(id: string, env: {
  GH_TOKEN: string;
  PR_NUMBER: string;
  LABEL: string;
}, props?: StepProps): ExtendedStep {
  return new ExtendedStep({
    id,
    ...props,
    name: "gh pr edit --add-label",
    env,
    run: `gh pr edit "$PR_NUMBER" --add-label "$LABEL" --repo "$GITHUB_REPOSITORY" || true`,
  });
}

/**
 * gh pr comment - Post comment on PR
 * @outputs comment_id
 */
export function ghPrComment(
  id: string,
  env: {
    GH_TOKEN: string;
    PR_NUMBER: string;
    BODY: string;
  },
): ExtendedStep {
  return new ExtendedStep({
    id,
    name: "gh pr comment",
    env,
    run: dedentString(`
      comment_url=$(gh pr comment "$PR_NUMBER" --body "$BODY" --repo "$GITHUB_REPOSITORY" 2>&1)
      comment_id=$(echo "$comment_url" | grep -oE '[0-9]+$' || echo "")
      ${echoKeyValue.toGithubOutput("comment_id", "$comment_id")}
    `),
    outputs: ["comment_id"],
  });
}

// =============================================================================
// gh issue - Issue Commands
// =============================================================================

/**
 * gh issue view - Get issue details
 * @outputs title, body, labels
 */
export function ghIssueView(
  id: string,
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
  },
) {
  return new ExtendedStep({
    id,
    name: "gh issue view",
    env,
    run: dedentString(`
      issue=$(gh issue view "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --json title,body,labels)
      ${echoKeyValue.toGithubOutput("title", '$(echo "$issue" | jq -r \'.title\')')}
      ${heredocOutput("body", 'echo "$issue" | jq -r \'.body\'')}
      ${echoKeyValue.toGithubOutput("labels", '$(echo "$issue" | jq -c \'[.labels[].name]\')')}
    `),
    outputs: ["title", "body", "labels"],
  });
}

/**
 * gh issue view --json labels - Check for specific label
 * @outputs has_label
 */
export function ghIssueViewHasLabel(
  id: string,
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
    LABEL: string;
  },
): ExtendedStep {
  return new ExtendedStep({
    id,
    name: "gh issue view (check label)",
    env,
    run: dedentString(`
      has_label=$(gh issue view "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --json labels --jq ".labels[].name" | grep -c "^$LABEL$" || true)
      ${echoKeyValue.toGithubOutput("has_label", '$([[ "$has_label" -gt 0 ]] && echo "true" || echo "false")')}
    `),
    outputs: ["has_label"],
  });
}

/**
 * gh issue edit --add-label - Add labels to issue
 * No outputs (action only)
 */
export function ghIssueEditAddLabel(id: string, env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  LABELS: string;
}, props?: StepProps): ExtendedStep {
  return new ExtendedStep({
    id,
    ...props,
    name: "gh issue edit --add-label",
    env,
    run: `gh issue edit "$ISSUE_NUMBER" --add-label "$LABELS" --repo "$GITHUB_REPOSITORY"`,
  });
}

/**
 * gh issue edit --remove-label - Remove labels from issue
 * No outputs (action only)
 */
export function ghIssueEditRemoveLabel(id: string, env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  LABELS: string;
}): ExtendedStep {
  return new ExtendedStep({
    id,
    name: "gh issue edit --remove-label",
    env,
    run: `gh issue edit "$ISSUE_NUMBER" --remove-label "$LABELS" --repo "$GITHUB_REPOSITORY"`,
  });
}

/**
 * gh issue edit --add-assignee - Add assignees to issue
 * No outputs (action only)
 */
export function ghIssueEditAddAssignee(id: string, env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  ASSIGNEES: string;
}): ExtendedStep {
  return new ExtendedStep({
    id,
    name: "gh issue edit --add-assignee",
    env,
    run: `gh issue edit "$ISSUE_NUMBER" --add-assignee "$ASSIGNEES" --repo "$GITHUB_REPOSITORY"`,
  });
}

/**
 * gh issue edit --remove-assignee - Remove assignees from issue
 * No outputs (action only)
 */
export function ghIssueEditRemoveAssignee(id: string, env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  ASSIGNEES: string;
}, props?: StepProps): ExtendedStep {
  return new ExtendedStep({
    id,
    ...props,
    name: "gh issue edit --remove-assignee",
    env,
    run: `gh issue edit "$ISSUE_NUMBER" --remove-assignee "$ASSIGNEES" --repo "$GITHUB_REPOSITORY"`,
  });
}

/**
 * gh issue comment - Post comment on issue
 * @outputs comment_id
 */
export function ghIssueComment(
  id: string,
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
    BODY: string;
  },
  props?: StepProps,
) {
  return new ExtendedStep({
    id,
    ...props,
    name: "gh issue comment",
    env,
    run: dedentString(`
      comment_url=$(gh issue comment "$ISSUE_NUMBER" --body "$BODY" --repo "$GITHUB_REPOSITORY" 2>&1)
      comment_id=$(echo "$comment_url" | grep -oE '[0-9]+$' || echo "")
      ${echoKeyValue.toGithubOutput("comment_id", "$comment_id")}
    `),
    outputs: ["comment_id"],
  });
}

// =============================================================================
// gh label - Label Commands
// =============================================================================

/**
 * gh label list - List labels
 * @outputs labels (JSON array of names)
 */
export function ghLabelList(
  id: string,
  env: {
    GH_TOKEN: string;
    SEARCH?: string;
  },
): ExtendedStep {
  const searchFilter = env.SEARCH ? '--search "$SEARCH"' : "";

  return new ExtendedStep({
    id,
    name: "gh label list",
    env,
    run: dedentString(`
      labels=$(gh label list --repo "$GITHUB_REPOSITORY" ${searchFilter} --json name --jq '[.[].name]')
      ${echoKeyValue.toGithubOutput("labels", "$labels")}
    `),
    outputs: ["labels"],
  });
}

/**
 * gh label create - Create a label
 * No outputs (action only)
 */
export function ghLabelCreate(id: string, env: {
  GH_TOKEN: string;
  NAME: string;
  DESCRIPTION?: string;
  COLOR?: string;
}): ExtendedStep {
  const descFlag = env.DESCRIPTION ? '--description "$DESCRIPTION"' : "";
  const colorFlag = env.COLOR ? '--color "$COLOR"' : "";

  return new ExtendedStep({
    id,
    name: "gh label create",
    env,
    run: `gh label create "$NAME" ${descFlag} ${colorFlag} --repo "$GITHUB_REPOSITORY" --force`,
  });
}

// =============================================================================
// gh api - API Commands
// =============================================================================

/**
 * gh api graphql - Run GraphQL query
 * @outputs result (JSON)
 */
export function ghApiGraphql(
  id: string,
  env: {
    GH_TOKEN: string;
    QUERY: string;
  },
  opts?: {
    variables?: Record<string, string>;
    headers?: Record<string, string>;
    jq?: string;
  },
): ExtendedStep {
  const variableFlags = opts?.variables
    ? Object.entries(opts.variables)
        .map(([k, v]) => `-F ${k}="${v}"`)
        .join(" ")
    : "";

  const headerFlags = opts?.headers
    ? Object.entries(opts.headers)
        .map(([k, v]) => `-H "${k}: ${v}"`)
        .join(" ")
    : "";

  const jqFlag = opts?.jq ? `--jq '${opts.jq}'` : "";

  return new ExtendedStep({
    id,
    name: "gh api graphql",
    env,
    run: dedentString(`
      result=$(gh api graphql -f query="$QUERY" ${variableFlags} ${headerFlags} ${jqFlag})
      ${heredocOutput("result", 'echo "$result"')}
    `),
    outputs: ["result"],
  });
}

/**
 * gh api (REST GET) - Make REST API GET request
 * @outputs result (JSON)
 */
export function ghApiGet(
  id: string,
  env: {
    GH_TOKEN: string;
    ENDPOINT: string;
  },
  opts?: {
    jq?: string;
  },
): ExtendedStep {
  const jqFlag = opts?.jq ? `--jq '${opts.jq}'` : "";

  return new ExtendedStep({
    id,
    name: "gh api GET",
    env,
    run: dedentString(`
      result=$(gh api "$ENDPOINT" ${jqFlag})
      ${heredocOutput("result", 'echo "$result"')}
    `),
    outputs: ["result"],
  });
}

/**
 * gh api (REST POST) - Make REST API POST request
 * No outputs (action only)
 */
export function ghApiPost(id: string, env: {
  GH_TOKEN: string;
  ENDPOINT: string;
  FIELD?: string;
  VALUE?: string;
}): ExtendedStep {
  const fieldFlag =
    env.FIELD && env.VALUE ? `-f ${env.FIELD}="$VALUE"` : "";

  return new ExtendedStep({
    id,
    name: "gh api POST",
    env,
    run: `gh api "$ENDPOINT" ${fieldFlag}`,
  });
}

/**
 * gh api (add reaction) - Add reaction to comment
 * No outputs (action only)
 */
export function ghApiAddReaction(id: string, env: {
  GH_TOKEN: string;
  COMMENT_ID: string;
  REACTION: string;
}, props?: StepProps): ExtendedStep {
  return new ExtendedStep({
    id,
    ...props,
    name: "gh api (add reaction)",
    env,
    run: `gh api "repos/$GITHUB_REPOSITORY/issues/comments/$COMMENT_ID/reactions" -f content="$REACTION"`,
  });
}

/**
 * gh api (count comments) - Count comments from specific user
 * @outputs count
 */
export function ghApiCountComments(
  id: string,
  env: {
    GH_TOKEN: string;
    PR_NUMBER: string;
    USER_LOGIN: string;
  },
) {
  return new ExtendedStep({
    id,
    name: "gh api (count comments)",
    env,
    run: dedentString(`
      review_comments=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/comments" --jq "[.[] | select(.user.login == \\"$USER_LOGIN\\")] | length")
      issue_comments=$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" --jq "[.[] | select(.user.login == \\"$USER_LOGIN\\")] | length")
      reviews=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/reviews" --jq "[.[] | select(.user.login == \\"$USER_LOGIN\\")] | length")
      total=$((review_comments + issue_comments + reviews))
      ${echoKeyValue.toGithubOutput("count", "$total")}
    `),
    outputs: ["count"],
  });
}

/**
 * gh api graphql (unresolved comments) - Count unresolved review threads
 * @outputs has_unresolved, unresolved_count
 */
export function ghApiUnresolvedComments(
  id: string,
  env: {
    GH_TOKEN: string;
    PR_NUMBER: string;
  },
) {
  const query = `
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
  `;

  return new ExtendedStep({
    id,
    name: "gh api graphql (unresolved comments)",
    env,
    run: dedentString(`
      repo_name="\${GITHUB_REPOSITORY#*/}"
      owner="\${GITHUB_REPOSITORY%/*}"

      result=$(gh api graphql -f query='${query.trim()}' \\
        -F owner="$owner" \\
        -F repo="$repo_name" \\
        -F pr="$PR_NUMBER")

      unresolved_count=$(echo "$result" | jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length')
      ${echoKeyValue.toGithubOutput("unresolved_count", "$unresolved_count")}
      ${echoKeyValue.toGithubOutput("has_unresolved", '$([[ "$unresolved_count" -gt 0 ]] && echo "true" || echo "false")')}
    `),
    outputs: ["has_unresolved", "unresolved_count"],
  });
}

/**
 * gh api graphql (update project status) - Update issue's project status field
 * No outputs (action only)
 */
export function ghApiUpdateProjectStatus(id: string, env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  TARGET_STATUS: string;
}, props?: StepProps) {
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

  return new ExtendedStep({
    id,
    ...props,
    name: "gh api graphql (update project status)",
    env,
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
  });
}

/**
 * gh issue view (with comments) - Get issue details including all comments
 * @outputs title, body, labels, comments
 */
export function ghIssueViewWithComments(
  id: string,
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
  },
) {
  return new ExtendedStep({
    id,
    name: "gh issue view (with comments)",
    env,
    run: dedentString(`
      issue=$(gh issue view "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --json title,body,labels,comments)
      ${echoKeyValue.toGithubOutput("title", '$(echo "$issue" | jq -r \'.title\')')}
      ${heredocOutput("body", 'echo "$issue" | jq -r \'.body\'')}
      ${echoKeyValue.toGithubOutput("labels", '$(echo "$issue" | jq -c \'[.labels[].name]\')')}
      ${heredocOutput("comments", 'echo "$issue" | jq -r \'.comments[] | "---\\nAuthor: \\(.author.login)\\n\\(.body)\\n"\'')}
    `),
    outputs: ["title", "body", "labels", "comments"],
  });
}

/**
 * gh pr list (for issue) - Find PR that fixes a specific issue
 * @outputs has_pr, pr_number, pr_branch, pr_url
 */
export function ghPrListForIssue(
  id: string,
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
  },
) {
  return new ExtendedStep({
    id,
    name: "gh pr list (for issue)",
    env,
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
  });
}

/**
 * gh api graphql (check sub-issue) - Check if issue is a sub-issue (has parent)
 * @outputs is_sub_issue, should_triage, issue_title, issue_body, issue_number
 */
export function ghApiCheckSubIssue(
  id: string,
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
  },
) {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          title
          body
          parent { number }
        }
      }
    }
  `;

  return new ExtendedStep({
    id,
    name: "gh api graphql (check sub-issue)",
    env,
    run: dedentString(`
      repo_name="\${GITHUB_REPOSITORY#*/}"
      owner="\${GITHUB_REPOSITORY%/*}"

      result=$(gh api graphql -H "GraphQL-Features: sub_issues" -f query='${query.trim()}' \\
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
    outputs: ["is_sub_issue", "should_triage", "issue_title", "issue_body", "issue_number"],
  });
}

/**
 * gh api graphql (check project status) - Check issue's project status
 * @outputs status, can_implement
 */
export function ghApiCheckProjectStatus(
  id: string,
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
  },
) {
  const query = `
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
  `;

  return new ExtendedStep({
    id,
    name: "gh api graphql (check project status)",
    env,
    run: dedentString(`
      repo_name="\${GITHUB_REPOSITORY#*/}"
      owner="\${GITHUB_REPOSITORY%/*}"

      result=$(gh api graphql -f query='${query.trim()}' \\
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
  });
}

/**
 * gh pr view (branch) - Get PR branch for an issue
 * @outputs is_pr, branch
 */
export function ghPrViewBranch(
  id: string,
  env: {
    GH_TOKEN: string;
    IS_PR: string;
    PR_NUMBER: string;
  },
  props?: StepProps,
) {
  return new ExtendedStep({
    id,
    ...props,
    name: "gh pr view (branch)",
    env,
    run: dedentString(`
      if [[ "$IS_PR" == "true" ]]; then
        branch=$(gh pr view "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --json headRefName --jq '.headRefName')
        ${echoKeyValue.toGithubOutput("is_pr", "true")}
        ${echoKeyValue.toGithubOutput("branch", "$branch")}
      else
        ${echoKeyValue.toGithubOutput("is_pr", "false")}
        ${echoKeyValue.toGithubOutput("branch", "main")}
      fi
    `),
    outputs: ["is_pr", "branch"],
  });
}

/**
 * gh pr view (linked issue) - Extract linked issue from PR body
 * @outputs has_issue, issue_number, issue_body
 */
export function ghPrViewLinkedIssue(
  id: string,
  env: {
    GH_TOKEN: string;
    PR_NUMBER: string;
  },
) {
  return new ExtendedStep({
    id,
    name: "gh pr view (linked issue)",
    env,
    run: dedentString(`
      pr_body=$(gh pr view "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --json body --jq '.body')

      # Extract issue number from PR body (Fixes #123 pattern)
      issue_number=$(echo "$pr_body" | grep -oE '(Fixes|Closes|Resolves) #[0-9]+' | head -1 | grep -oE '[0-9]+' || echo "")

      if [[ -n "$issue_number" ]]; then
        ${echoKeyValue.toGithubOutput("has_issue", "true")}
        ${echoKeyValue.toGithubOutput("issue_number", "$issue_number")}

        # Fetch the linked issue body
        issue_body=$(gh issue view "$issue_number" --repo "$GITHUB_REPOSITORY" --json body --jq '.body')
        ${heredocOutput("issue_body", 'echo "$issue_body"')}
      else
        ${echoKeyValue.toGithubOutput("has_issue", "false")}
        ${echoKeyValue.toGithubOutput("issue_number", "")}
        ${heredocOutput("issue_body", "echo ''")}
      fi
    `),
    outputs: ["has_issue", "issue_number", "issue_body"],
  });
}

/**
 * gh pr view (check claude) - Check if PR is a Claude PR
 * @outputs is_claude_pr
 */
export function ghPrViewCheckClaude(
  id: string,
  env: {
    GH_TOKEN: string;
    PR_NUMBER: string;
  },
) {
  return new ExtendedStep({
    id,
    name: "gh pr view (check claude)",
    env,
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
  });
}

/**
 * gh pr edit --remove-reviewer - Remove reviewer from PR
 * No outputs (action only)
 */
export function ghPrEditRemoveReviewer(id: string, env: {
  GH_TOKEN: string;
  PR_NUMBER: string;
  REVIEWERS: string;
}) {
  return new ExtendedStep({
    id,
    name: "gh pr edit --remove-reviewer",
    env,
    run: `gh pr edit "$PR_NUMBER" --remove-reviewer "$REVIEWERS" --repo "$GITHUB_REPOSITORY" || true`,
  });
}

/**
 * gh pr view (extended) - Get PR details including body and linked issue
 * @outputs has_pr, is_claude_pr, is_draft, pr_number, pr_head_branch, pr_body, has_issue, issue_number
 */
export function ghPrViewExtended(
  id: string,
  env: {
    GH_TOKEN: string;
    HEAD_BRANCH?: string;
    PR_NUMBER?: string;
  },
): ExtendedStep {
  return new ExtendedStep({
    id,
    name: "gh pr view (extended)",
    env,
    run: dedentString(`
      # Determine how to find the PR
      if [[ -n "$PR_NUMBER" ]]; then
        pr=$(gh pr view "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --json number,isDraft,author,headRefName,body 2>/dev/null || echo "")
      elif [[ -n "$HEAD_BRANCH" ]]; then
        pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --head "$HEAD_BRANCH" --json number,isDraft,author,headRefName,body --jq '.[0]' 2>/dev/null || echo "")
      else
        echo "Either PR_NUMBER or HEAD_BRANCH must be provided"
        exit 1
      fi

      # Check if PR was found
      if [[ -z "$pr" || "$pr" == "null" ]]; then
        ${echoKeyValue.toGithubOutput("has_pr", "false")}
        ${echoKeyValue.toGithubOutput("is_claude_pr", "false")}
        ${echoKeyValue.toGithubOutput("is_draft", "false")}
        ${echoKeyValue.toGithubOutput("pr_number", "")}
        ${echoKeyValue.toGithubOutput("pr_head_branch", "")}
        ${echoKeyValue.toGithubOutput("has_issue", "false")}
        ${echoKeyValue.toGithubOutput("issue_number", "")}
        ${heredocOutput("pr_body", "echo ''")}
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
      ${echoKeyValue.toGithubOutput("has_pr", "true")}
      ${echoKeyValue.toGithubOutput("is_claude_pr", "$is_claude_pr")}
      ${echoKeyValue.toGithubOutput("is_draft", "$is_draft")}
      ${echoKeyValue.toGithubOutput("pr_number", "$pr_number")}
      ${echoKeyValue.toGithubOutput("pr_head_branch", "$head_branch")}
      ${echoKeyValue.toGithubOutput("has_issue", "$has_issue")}
      ${echoKeyValue.toGithubOutput("issue_number", "$issue_number")}
      ${heredocOutput("pr_body", 'echo "$body"')}
    `),
    outputs: ["has_pr", "is_claude_pr", "is_draft", "pr_number", "pr_head_branch", "pr_body", "has_issue", "issue_number"],
  });
}

// =============================================================================
// Triage Steps
// =============================================================================

/**
 * Parse triage-output.json file
 * @outputs has_output, type, priority, size, estimate, needs_info, topics, labels
 */
export function parseTriageOutput(id: string, props?: StepProps): ExtendedStep {
  return new ExtendedStep({
    id,
    ...props,
    name: "Parse triage output",
    run: dedentString(`
      # Check if triage output exists
      if [[ ! -f triage-output.json ]]; then
        echo "WARNING: triage-output.json not found"
        ${echoKeyValue.toGithubOutput("has_output", "false")}
        exit 0
      fi

      ${echoKeyValue.toGithubOutput("has_output", "true")}

      # Parse triage output
      TYPE=$(jq -r '.type // empty' triage-output.json)
      PRIORITY=$(jq -r '.priority // empty' triage-output.json)
      SIZE=$(jq -r '.size // empty' triage-output.json)
      ESTIMATE=$(jq -r '.estimate // 5' triage-output.json)
      NEEDS_INFO=$(jq -r '.needs_info // false' triage-output.json)
      TOPICS=$(jq -r '.topics // [] | join(",")' triage-output.json)

      # Build labels list
      LABELS="triaged"
      [[ -n "$TYPE" && "$TYPE" != "null" ]] && LABELS="$LABELS,$TYPE"
      [[ "$NEEDS_INFO" == "true" ]] && LABELS="$LABELS,needs-info"

      # Output parsed values
      ${echoKeyValue.toGithubOutput("type", "$TYPE")}
      ${echoKeyValue.toGithubOutput("priority", "$PRIORITY")}
      ${echoKeyValue.toGithubOutput("size", "$SIZE")}
      ${echoKeyValue.toGithubOutput("estimate", "$ESTIMATE")}
      ${echoKeyValue.toGithubOutput("needs_info", "$NEEDS_INFO")}
      ${echoKeyValue.toGithubOutput("topics", "$TOPICS")}
      ${echoKeyValue.toGithubOutput("labels", "$LABELS")}

      echo "Parsed: type=$TYPE priority=$PRIORITY size=$SIZE estimate=$ESTIMATE"
    `),
    outputs: ["has_output", "type", "priority", "size", "estimate", "needs_info", "topics", "labels"],
  });
}

/**
 * gh api graphql (get project item) - Get project item ID for an issue
 * @outputs has_project, item_id, project_id
 */
export function ghApiGetProjectItem(
  id: string,
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
  },
  props?: StepProps,
): ExtendedStep {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          projectItems(first: 1) {
            nodes { id project { id } }
          }
        }
      }
    }
  `;

  return new ExtendedStep({
    id,
    ...props,
    name: "gh api graphql (get project item)",
    env,
    run: dedentString(`
      repo_name="\${GITHUB_REPOSITORY#*/}"
      owner="\${GITHUB_REPOSITORY%/*}"

      result=$(gh api graphql -f query='${query.trim()}' \\
        -f owner="$owner" \\
        -f repo="$repo_name" \\
        -F number="$ISSUE_NUMBER" 2>/dev/null || echo '{}')

      item_id=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0].id // empty')
      project_id=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0].project.id // empty')

      if [[ -z "$item_id" || "$item_id" == "null" ]]; then
        echo "Issue #$ISSUE_NUMBER not linked to any project"
        ${echoKeyValue.toGithubOutput("has_project", "false")}
        exit 0
      fi

      ${echoKeyValue.toGithubOutput("has_project", "true")}
      ${echoKeyValue.toGithubOutput("item_id", "$item_id")}
      ${echoKeyValue.toGithubOutput("project_id", "$project_id")}
    `),
    outputs: ["has_project", "item_id", "project_id"],
  });
}

/**
 * gh api graphql (update project priority) - Update issue's project Priority field
 * Maps priority string (critical/high/etc) to option ID
 * No outputs (action only)
 */
export function ghApiUpdateProjectPriority(id: string, env: {
  GH_TOKEN: string;
  PROJECT_ID: string;
  ITEM_ID: string;
  PRIORITY: string;
}, props?: StepProps): ExtendedStep {
  // Hardcoded field ID and option IDs from project.ts
  const FIELD_ID = "PVTSSF_lADOBBYMds4BMB5szg7bd4o";
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
        value: { singleSelectOptionId: $optionId }
      }) { projectV2Item { id } }
    }
  `;

  return new ExtendedStep({
    id,
    ...props,
    name: "gh api graphql (update project priority)",
    env,
    run: dedentString(`
      # Map priority to option ID
      case "$PRIORITY" in
        critical) OPTION_ID="79628723" ;;  # P0
        high)     OPTION_ID="0a877460" ;;  # P1
        *)        OPTION_ID="da944a9c" ;;  # P2
      esac

      gh api graphql -f query='${mutation.trim()}' \\
        -f projectId="$PROJECT_ID" \\
        -f itemId="$ITEM_ID" \\
        -f fieldId="${FIELD_ID}" \\
        -f optionId="$OPTION_ID"
    `),
  });
}

/**
 * gh api graphql (update project size) - Update issue's project Size field
 * Maps size string (xs/s/m/l/xl) to option ID
 * No outputs (action only)
 */
export function ghApiUpdateProjectSize(id: string, env: {
  GH_TOKEN: string;
  PROJECT_ID: string;
  ITEM_ID: string;
  SIZE: string;
}, props?: StepProps): ExtendedStep {
  // Hardcoded field ID and option IDs from project.ts
  const FIELD_ID = "PVTSSF_lADOBBYMds4BMB5szg7bd4s";
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
        value: { singleSelectOptionId: $optionId }
      }) { projectV2Item { id } }
    }
  `;

  return new ExtendedStep({
    id,
    ...props,
    name: "gh api graphql (update project size)",
    env,
    run: dedentString(`
      # Map size to option ID
      case "$SIZE" in
        xs) OPTION_ID="6c6483d2" ;;
        s)  OPTION_ID="f784b110" ;;
        m)  OPTION_ID="7515a9f1" ;;
        l)  OPTION_ID="817d0097" ;;
        xl) OPTION_ID="db339eb2" ;;
        *)  OPTION_ID="7515a9f1" ;;  # Default to M
      esac

      gh api graphql -f query='${mutation.trim()}' \\
        -f projectId="$PROJECT_ID" \\
        -f itemId="$ITEM_ID" \\
        -f fieldId="${FIELD_ID}" \\
        -f optionId="$OPTION_ID"
    `),
  });
}

/**
 * gh api graphql (update project estimate) - Update issue's project Estimate field
 * No outputs (action only)
 */
export function ghApiUpdateProjectEstimate(id: string, env: {
  GH_TOKEN: string;
  PROJECT_ID: string;
  ITEM_ID: string;
  ESTIMATE: string;
}, props?: StepProps): ExtendedStep {
  // Hardcoded field ID from project.ts
  const FIELD_ID = "PVTF_lADOBBYMds4BMB5szg7bd4w";
  const mutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $number: Float!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
        value: { number: $number }
      }) { projectV2Item { id } }
    }
  `;

  return new ExtendedStep({
    id,
    ...props,
    name: "gh api graphql (update project estimate)",
    env,
    run: dedentString(`
      gh api graphql -f query='${mutation.trim()}' \\
        -f projectId="$PROJECT_ID" \\
        -f itemId="$ITEM_ID" \\
        -f fieldId="${FIELD_ID}" \\
        -F number="$ESTIMATE"
    `),
  });
}

/**
 * Create and apply topic labels - batch processes topic labels
 * This is an exception to atomic pattern as it loops through topics
 * No outputs (action only)
 */
export function ghApplyTopicLabels(id: string, env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  TOPICS: string;
}, props?: StepProps): ExtendedStep {
  return new ExtendedStep({
    id,
    ...props,
    name: "Create and apply topic labels",
    env,
    run: dedentString(`
      # Skip if no topics
      [[ -z "$TOPICS" ]] && exit 0

      IFS=',' read -ra TOPIC_ARRAY <<< "$TOPICS"
      for topic in "\${TOPIC_ARRAY[@]}"; do
        [[ -z "$topic" ]] && continue
        topic_label="topic:$topic"

        # Create label if it doesn't exist (--force updates if exists)
        gh label create "$topic_label" --color "7057ff" --description "Related to $topic" --repo "$GITHUB_REPOSITORY" --force || true

        # Add label to issue
        gh issue edit "$ISSUE_NUMBER" --add-label "$topic_label" --repo "$GITHUB_REPOSITORY" || true
      done
    `),
  });
}

// =============================================================================
// Batch Processing Steps (exceptions to atomic pattern)
// =============================================================================

/**
 * Detect stalled review requests - batch processes all PRs with nopo-bot requested
 * This is an exception to the atomic step pattern as it requires looping through
 * multiple PRs and making conditional API calls per PR.
 * No outputs (posts comments to stalled PRs)
 */
export function ghDetectStalledReviews(id: string, env: {
  GH_TOKEN: string;
  DRY_RUN: string;
}): ExtendedStep {
  const script = `
echo "Checking for PRs with stalled nopo-bot review requests..."

# Get all open PRs with nopo-bot as requested reviewer
prs=$(gh pr list --repo "$GITHUB_REPOSITORY" --state open --json number,title,headRefName,isDraft,reviewRequests,createdAt,updatedAt)

echo "$prs" | jq -c '.[]' | while read -r pr; do
  pr_number=$(echo "$pr" | jq -r '.number')
  pr_title=$(echo "$pr" | jq -r '.title')
  is_draft=$(echo "$pr" | jq -r '.isDraft')
  review_requests=$(echo "$pr" | jq -r '.reviewRequests')

  # Check if nopo-bot is requested
  has_nopo_bot=$(echo "$review_requests" | jq '[.[] | select(.login == "nopo-bot")] | length')

  if [[ "$has_nopo_bot" -eq 0 ]]; then
    continue
  fi

  echo "PR #$pr_number has nopo-bot requested"

  # Check if there's a recent "reviewing" comment from nopo-bot
  recent_comment=$(gh api "/repos/$GITHUB_REPOSITORY/issues/$pr_number/comments" \\
    --jq '[.[] | select(.user.login == "github-actions[bot]" and (.body | contains("nopo-bot") and contains("reviewing")))] | sort_by(.created_at) | last // empty')

  if [[ -n "$recent_comment" ]]; then
    comment_time=$(echo "$recent_comment" | jq -r '.created_at')
    echo "  Found reviewing comment at: $comment_time"
    # Review is in progress, not stalled
    continue
  fi

  # No recent reviewing comment - check if review was submitted
  reviews=$(gh api "/repos/$GITHUB_REPOSITORY/pulls/$pr_number/reviews" \\
    --jq '[.[] | select(.user.login == "claude[bot]")] | length')

  if [[ "$reviews" -gt 0 ]]; then
    echo "  Claude already reviewed - not stalled"
    continue
  fi

  # Determine why the review might be stalled
  reason=""
  if [[ "$is_draft" == "true" ]]; then
    reason="PR is a draft (reviews are skipped for drafts)"
  else
    reason="No review started - possible webhook failure or workflow error"
  fi

  echo "  STALLED: $reason"

  if [[ "\${DRY_RUN:-false}" == "true" ]]; then
    echo "  [DRY RUN] Would post comment to PR #$pr_number"
    continue
  fi

  # Check if we already posted a stalled notification recently (within 2 hours)
  existing_notification=$(gh api "/repos/$GITHUB_REPOSITORY/issues/$pr_number/comments" \\
    --jq '[.[] | select(.user.login == "github-actions[bot]" and (.body | contains("Review Request Stalled")))] | sort_by(.created_at) | last // empty')

  if [[ -n "$existing_notification" ]]; then
    notification_time=$(echo "$existing_notification" | jq -r '.created_at')
    # Skip if notification is less than 2 hours old
    notification_epoch=$(date -d "$notification_time" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$notification_time" +%s 2>/dev/null || echo "0")
    current_epoch=$(date +%s)
    hours_diff=$(( (current_epoch - notification_epoch) / 3600 ))

    if [[ "$hours_diff" -lt 2 ]]; then
      echo "  Already notified $hours_diff hours ago - skipping"
      continue
    fi
  fi

  # Post diagnostic comment
  gh pr comment "$pr_number" --body "## ⚠️ Review Request Stalled

**nopo-bot** was requested as a reviewer but no review has started.

**Possible reason:** $reason

**To retry:**
1. Remove nopo-bot from reviewers: \\\`gh pr edit $pr_number --remove-reviewer nopo-bot\\\`
2. Re-add nopo-bot: \\\`gh pr edit $pr_number --add-reviewer nopo-bot\\\`

Or check the [Actions tab](https://github.com/$GITHUB_REPOSITORY/actions/workflows/claude-review-loop.yml) for failed workflow runs.

_This is an automated diagnostic message._"

  echo "  Posted stalled review notification"
done

echo "Done checking for stalled reviews"
`.trim();

  return new ExtendedStep({
    id,
    name: "Detect stalled review requests",
    env,
    run: script,
  });
}
