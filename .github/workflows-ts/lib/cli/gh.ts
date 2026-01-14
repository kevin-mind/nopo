/**
 * Atomic GitHub CLI step generators.
 * Each function generates a Step that executes exactly ONE `gh` CLI command.
 *
 * Naming convention: gh<Subcommand> → gh <subcommand>
 * - ghPrList → gh pr list
 * - ghIssueEdit → gh issue edit
 * - ghApiGraphql → gh api graphql
 */

import { Step } from "@github-actions-workflow-ts/lib";

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
): Step {
  const headFilter = env.HEAD_BRANCH ? '--head "$HEAD_BRANCH"' : "";
  const stateFilter = env.STATE ? '--state "$STATE"' : "";

  return new Step({
    id,
    name: "gh pr list",
    env,
    run: `pr=$(gh pr list --repo "$GITHUB_REPOSITORY" ${headFilter} ${stateFilter} --json number,isDraft,author,headRefName --jq '.[0]')
echo "number=$(echo "$pr" | jq -r '.number // empty')" >> $GITHUB_OUTPUT
echo "is_draft=$(echo "$pr" | jq -r '.isDraft // empty')" >> $GITHUB_OUTPUT
echo "author=$(echo "$pr" | jq -r '.author.login // empty')" >> $GITHUB_OUTPUT
echo "head_branch=$(echo "$pr" | jq -r '.headRefName // empty')" >> $GITHUB_OUTPUT
echo "found=$([[ -n "$pr" && "$pr" != "null" ]] && echo "true" || echo "false")" >> $GITHUB_OUTPUT`,
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
): Step {
  return new Step({
    id,
    name: "gh pr view",
    env,
    run: `pr=$(gh pr view "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --json number,isDraft,author,headRefName,body)
echo "number=$(echo "$pr" | jq -r '.number')" >> $GITHUB_OUTPUT
echo "is_draft=$(echo "$pr" | jq -r '.isDraft')" >> $GITHUB_OUTPUT
echo "author=$(echo "$pr" | jq -r '.author.login')" >> $GITHUB_OUTPUT
echo "head_branch=$(echo "$pr" | jq -r '.headRefName')" >> $GITHUB_OUTPUT
{
  echo 'body<<EOF'
  echo "$pr" | jq -r '.body'
  echo 'EOF'
} >> $GITHUB_OUTPUT`,
  });
}

/**
 * gh pr ready - Mark PR as ready for review
 * No outputs (action only)
 */
export function ghPrReady(env: { GH_TOKEN: string; PR_NUMBER: string }): Step {
  return new Step({
    name: "gh pr ready",
    env,
    run: `gh pr ready "$PR_NUMBER" --repo "$GITHUB_REPOSITORY"`,
  });
}

/**
 * gh pr ready --undo - Convert PR to draft
 * No outputs (action only)
 */
export function ghPrReadyUndo(env: {
  GH_TOKEN: string;
  PR_NUMBER: string;
}): Step {
  return new Step({
    name: "gh pr ready --undo",
    env,
    run: `gh pr ready "$PR_NUMBER" --undo --repo "$GITHUB_REPOSITORY"`,
  });
}

/**
 * gh pr edit --add-reviewer - Add reviewers to PR
 * No outputs (action only)
 */
export function ghPrEditAddReviewer(env: {
  GH_TOKEN: string;
  PR_NUMBER: string;
  REVIEWERS: string;
}): Step {
  return new Step({
    name: "gh pr edit --add-reviewer",
    env,
    run: `gh pr edit "$PR_NUMBER" --add-reviewer "$REVIEWERS" --repo "$GITHUB_REPOSITORY"`,
  });
}

/**
 * gh pr edit --add-label - Add label to PR
 * No outputs (action only)
 */
export function ghPrEditAddLabel(env: {
  GH_TOKEN: string;
  PR_NUMBER: string;
  LABEL: string;
}): Step {
  return new Step({
    name: "gh pr edit --add-label",
    env,
    run: `gh pr edit "$PR_NUMBER" --add-label "$LABEL" --repo "$GITHUB_REPOSITORY" || true`,
  });
}

/**
 * gh pr comment - Post comment on PR
 * @outputs comment_id (if id is provided)
 */
export function ghPrComment(
  idOrEnv:
    | string
    | {
        GH_TOKEN: string;
        PR_NUMBER: string;
        BODY: string;
      },
  envArg?: {
    GH_TOKEN: string;
    PR_NUMBER: string;
    BODY: string;
  },
): Step {
  // Support both (id, env) and (env) signatures
  const id = typeof idOrEnv === "string" ? idOrEnv : undefined;
  const env = typeof idOrEnv === "string" ? envArg! : idOrEnv;

  return new Step({
    id,
    name: "gh pr comment",
    env,
    run: `comment_url=$(gh pr comment "$PR_NUMBER" --body "$BODY" --repo "$GITHUB_REPOSITORY" 2>&1)
comment_id=$(echo "$comment_url" | grep -oE '[0-9]+$' || echo "")
echo "comment_id=$comment_id" >> $GITHUB_OUTPUT`,
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
): Step {
  return new Step({
    id,
    name: "gh issue view",
    env,
    run: `issue=$(gh issue view "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --json title,body,labels)
echo "title=$(echo "$issue" | jq -r '.title')" >> $GITHUB_OUTPUT
{
  echo 'body<<EOF'
  echo "$issue" | jq -r '.body'
  echo 'EOF'
} >> $GITHUB_OUTPUT
echo "labels=$(echo "$issue" | jq -c '[.labels[].name]')" >> $GITHUB_OUTPUT`,
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
): Step {
  return new Step({
    id,
    name: "gh issue view (check label)",
    env,
    run: `has_label=$(gh issue view "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --json labels --jq ".labels[].name" | grep -c "^$LABEL$" || true)
echo "has_label=$([[ "$has_label" -gt 0 ]] && echo "true" || echo "false")" >> $GITHUB_OUTPUT`,
  });
}

/**
 * gh issue edit --add-label - Add labels to issue
 * No outputs (action only)
 */
export function ghIssueEditAddLabel(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  LABELS: string;
}): Step {
  return new Step({
    name: "gh issue edit --add-label",
    env,
    run: `gh issue edit "$ISSUE_NUMBER" --add-label "$LABELS" --repo "$GITHUB_REPOSITORY"`,
  });
}

/**
 * gh issue edit --remove-label - Remove labels from issue
 * No outputs (action only)
 */
export function ghIssueEditRemoveLabel(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  LABELS: string;
}): Step {
  return new Step({
    name: "gh issue edit --remove-label",
    env,
    run: `gh issue edit "$ISSUE_NUMBER" --remove-label "$LABELS" --repo "$GITHUB_REPOSITORY"`,
  });
}

/**
 * gh issue edit --add-assignee - Add assignees to issue
 * No outputs (action only)
 */
export function ghIssueEditAddAssignee(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  ASSIGNEES: string;
}): Step {
  return new Step({
    name: "gh issue edit --add-assignee",
    env,
    run: `gh issue edit "$ISSUE_NUMBER" --add-assignee "$ASSIGNEES" --repo "$GITHUB_REPOSITORY"`,
  });
}

/**
 * gh issue edit --remove-assignee - Remove assignees from issue
 * No outputs (action only)
 */
export function ghIssueEditRemoveAssignee(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  ASSIGNEES: string;
}): Step {
  return new Step({
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
): Step {
  return new Step({
    id,
    name: "gh issue comment",
    env,
    run: `comment_url=$(gh issue comment "$ISSUE_NUMBER" --body "$BODY" --repo "$GITHUB_REPOSITORY" 2>&1)
comment_id=$(echo "$comment_url" | grep -oE '[0-9]+$' || echo "")
echo "comment_id=$comment_id" >> $GITHUB_OUTPUT`,
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
): Step {
  const searchFilter = env.SEARCH ? '--search "$SEARCH"' : "";

  return new Step({
    id,
    name: "gh label list",
    env,
    run: `labels=$(gh label list --repo "$GITHUB_REPOSITORY" ${searchFilter} --json name --jq '[.[].name]')
echo "labels=$labels" >> $GITHUB_OUTPUT`,
  });
}

/**
 * gh label create - Create a label
 * No outputs (action only)
 */
export function ghLabelCreate(env: {
  GH_TOKEN: string;
  NAME: string;
  DESCRIPTION?: string;
  COLOR?: string;
}): Step {
  const descFlag = env.DESCRIPTION ? '--description "$DESCRIPTION"' : "";
  const colorFlag = env.COLOR ? '--color "$COLOR"' : "";

  return new Step({
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
): Step {
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

  return new Step({
    id,
    name: "gh api graphql",
    env,
    run: `result=$(gh api graphql -f query="$QUERY" ${variableFlags} ${headerFlags} ${jqFlag})
{
  echo 'result<<EOF'
  echo "$result"
  echo 'EOF'
} >> $GITHUB_OUTPUT`,
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
): Step {
  const jqFlag = opts?.jq ? `--jq '${opts.jq}'` : "";

  return new Step({
    id,
    name: "gh api GET",
    env,
    run: `result=$(gh api "$ENDPOINT" ${jqFlag})
{
  echo 'result<<EOF'
  echo "$result"
  echo 'EOF'
} >> $GITHUB_OUTPUT`,
  });
}

/**
 * gh api (REST POST) - Make REST API POST request
 * No outputs (action only)
 */
export function ghApiPost(env: {
  GH_TOKEN: string;
  ENDPOINT: string;
  FIELD?: string;
  VALUE?: string;
}): Step {
  const fieldFlag =
    env.FIELD && env.VALUE ? `-f ${env.FIELD}="$VALUE"` : "";

  return new Step({
    name: "gh api POST",
    env,
    run: `gh api "$ENDPOINT" ${fieldFlag}`,
  });
}

/**
 * gh api (add reaction) - Add reaction to comment
 * No outputs (action only)
 */
export function ghApiAddReaction(env: {
  GH_TOKEN: string;
  COMMENT_ID: string;
  REACTION: string;
}): Step {
  return new Step({
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
): Step {
  return new Step({
    id,
    name: "gh api (count comments)",
    env,
    run: `review_comments=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/comments" --jq "[.[] | select(.user.login == \\"$USER_LOGIN\\")] | length")
issue_comments=$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" --jq "[.[] | select(.user.login == \\"$USER_LOGIN\\")] | length")
reviews=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/reviews" --jq "[.[] | select(.user.login == \\"$USER_LOGIN\\")] | length")
total=$((review_comments + issue_comments + reviews))
echo "count=$total" >> $GITHUB_OUTPUT`,
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
): Step {
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

  return new Step({
    id,
    name: "gh api graphql (unresolved comments)",
    env,
    run: `repo_name="\${GITHUB_REPOSITORY#*/}"
owner="\${GITHUB_REPOSITORY%/*}"

result=$(gh api graphql -f query='${query.trim()}' \
  -F owner="$owner" \
  -F repo="$repo_name" \
  -F pr="$PR_NUMBER")

unresolved_count=$(echo "$result" | jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length')
echo "unresolved_count=$unresolved_count" >> $GITHUB_OUTPUT
echo "has_unresolved=$([[ "$unresolved_count" -gt 0 ]] && echo "true" || echo "false")" >> $GITHUB_OUTPUT`,
  });
}

/**
 * gh api graphql (update project status) - Update issue's project status field
 * No outputs (action only)
 */
export function ghApiUpdateProjectStatus(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  TARGET_STATUS: string;
}): Step {
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

  return new Step({
    name: "gh api graphql (update project status)",
    env,
    run: `repo_name="\${GITHUB_REPOSITORY#*/}"
owner="\${GITHUB_REPOSITORY%/*}"

# Find the project item
result=$(gh api graphql -f query='${findItemQuery.trim()}' \
  -F owner="$owner" \
  -F repo="$repo_name" \
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
gh api graphql -f query='${updateMutation.trim()}' \
  -F projectId="$project_id" \
  -F itemId="$item_id" \
  -F fieldId="$field_id" \
  -F optionId="$option_id"

echo "Updated project status to '$TARGET_STATUS'"`,
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
): Step {
  return new Step({
    id,
    name: "gh issue view (with comments)",
    env,
    run: `issue=$(gh issue view "$ISSUE_NUMBER" --repo "$GITHUB_REPOSITORY" --json title,body,labels,comments)
echo "title=$(echo "$issue" | jq -r '.title')" >> $GITHUB_OUTPUT
{
  echo 'body<<EOF'
  echo "$issue" | jq -r '.body'
  echo 'EOF'
} >> $GITHUB_OUTPUT
echo "labels=$(echo "$issue" | jq -c '[.labels[].name]')" >> $GITHUB_OUTPUT
{
  echo 'comments<<EOF'
  echo "$issue" | jq -r '.comments[] | "---\\nAuthor: \\(.author.login)\\n\\(.body)\\n"'
  echo 'EOF'
} >> $GITHUB_OUTPUT`,
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
): Step {
  return new Step({
    id,
    name: "gh pr list (for issue)",
    env,
    run: `# Search for PRs that mention "Fixes #N" or "Closes #N"
prs=$(gh pr list --repo "$GITHUB_REPOSITORY" --state open --json number,headRefName,url,body)

# Find PR that references this issue
pr=$(echo "$prs" | jq -r --arg issue "$ISSUE_NUMBER" '
  .[] | select(.body | test("(Fixes|Closes|Resolves) #" + $issue + "([^0-9]|$)"; "i"))
' | head -1)

if [[ -n "$pr" && "$pr" != "null" ]]; then
  echo "has_pr=true" >> $GITHUB_OUTPUT
  echo "pr_number=$(echo "$pr" | jq -r '.number')" >> $GITHUB_OUTPUT
  echo "pr_branch=$(echo "$pr" | jq -r '.headRefName')" >> $GITHUB_OUTPUT
  echo "pr_url=$(echo "$pr" | jq -r '.url')" >> $GITHUB_OUTPUT
else
  echo "has_pr=false" >> $GITHUB_OUTPUT
  echo "pr_number=" >> $GITHUB_OUTPUT
  echo "pr_branch=" >> $GITHUB_OUTPUT
  echo "pr_url=" >> $GITHUB_OUTPUT
fi`,
  });
}

/**
 * gh api graphql (check sub-issue) - Check if issue is a sub-issue (has parent)
 * @outputs is_sub_issue, should_triage, issue_title, issue_body
 */
export function ghApiCheckSubIssue(
  id: string,
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
  },
): Step {
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

  return new Step({
    id,
    name: "gh api graphql (check sub-issue)",
    env,
    run: `repo_name="\${GITHUB_REPOSITORY#*/}"
owner="\${GITHUB_REPOSITORY%/*}"

result=$(gh api graphql -H "GraphQL-Features: sub_issues" -f query='${query.trim()}' \
  -F owner="$owner" \
  -F repo="$repo_name" \
  -F number="$ISSUE_NUMBER" 2>/dev/null || echo '{"data":{"repository":{"issue":null}}}')

issue=$(echo "$result" | jq -r '.data.repository.issue')

if [[ -z "$issue" || "$issue" == "null" ]]; then
  echo "is_sub_issue=false" >> $GITHUB_OUTPUT
  echo "should_triage=false" >> $GITHUB_OUTPUT
  echo "issue_title=" >> $GITHUB_OUTPUT
  {
    echo 'issue_body<<EOF'
    echo ''
    echo 'EOF'
  } >> $GITHUB_OUTPUT
  exit 0
fi

parent=$(echo "$issue" | jq -r '.parent.number // empty')
title=$(echo "$issue" | jq -r '.title')
body=$(echo "$issue" | jq -r '.body // ""')

if [[ -n "$parent" ]]; then
  echo "is_sub_issue=true" >> $GITHUB_OUTPUT
  echo "should_triage=false" >> $GITHUB_OUTPUT
else
  echo "is_sub_issue=false" >> $GITHUB_OUTPUT
  echo "should_triage=true" >> $GITHUB_OUTPUT
fi

echo "issue_title=$title" >> $GITHUB_OUTPUT
echo "issue_number=$ISSUE_NUMBER" >> $GITHUB_OUTPUT
{
  echo 'issue_body<<EOF'
  echo "$body"
  echo 'EOF'
} >> $GITHUB_OUTPUT`,
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
): Step {
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

  return new Step({
    id,
    name: "gh api graphql (check project status)",
    env,
    run: `repo_name="\${GITHUB_REPOSITORY#*/}"
owner="\${GITHUB_REPOSITORY%/*}"

result=$(gh api graphql -f query='${query.trim()}' \
  -F owner="$owner" \
  -F repo="$repo_name" \
  -F issue="$ISSUE_NUMBER" 2>/dev/null || echo '{}')

status=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0].fieldValueByName.name // ""')

echo "status=$status" >> $GITHUB_OUTPUT

# Can implement if status is empty, Ready, or Backlog
if [[ -z "$status" || "$status" == "Ready" || "$status" == "Backlog" ]]; then
  echo "can_implement=true" >> $GITHUB_OUTPUT
else
  echo "can_implement=false" >> $GITHUB_OUTPUT
fi`,
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
): Step {
  return new Step({
    id,
    name: "gh pr view (branch)",
    env,
    run: `if [[ "$IS_PR" == "true" ]]; then
  branch=$(gh pr view "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --json headRefName --jq '.headRefName')
  echo "is_pr=true" >> $GITHUB_OUTPUT
  echo "branch=$branch" >> $GITHUB_OUTPUT
else
  echo "is_pr=false" >> $GITHUB_OUTPUT
  echo "branch=main" >> $GITHUB_OUTPUT
fi`,
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
): Step {
  return new Step({
    id,
    name: "gh pr view (linked issue)",
    env,
    run: `pr_body=$(gh pr view "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --json body --jq '.body')

# Extract issue number from PR body (Fixes #123 pattern)
issue_number=$(echo "$pr_body" | grep -oE '(Fixes|Closes|Resolves) #[0-9]+' | head -1 | grep -oE '[0-9]+' || echo "")

if [[ -n "$issue_number" ]]; then
  echo "has_issue=true" >> $GITHUB_OUTPUT
  echo "issue_number=$issue_number" >> $GITHUB_OUTPUT

  # Fetch the linked issue body
  issue_body=$(gh issue view "$issue_number" --repo "$GITHUB_REPOSITORY" --json body --jq '.body')
  {
    echo 'issue_body<<EOF'
    echo "$issue_body"
    echo 'EOF'
  } >> $GITHUB_OUTPUT
else
  echo "has_issue=false" >> $GITHUB_OUTPUT
  echo "issue_number=" >> $GITHUB_OUTPUT
  {
    echo 'issue_body<<EOF'
    echo ''
    echo 'EOF'
  } >> $GITHUB_OUTPUT
fi`,
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
): Step {
  return new Step({
    id,
    name: "gh pr view (check claude)",
    env,
    run: `pr=$(gh pr view "$PR_NUMBER" --repo "$GITHUB_REPOSITORY" --json headRefName,author)
author=$(echo "$pr" | jq -r '.author.login')
head_branch=$(echo "$pr" | jq -r '.headRefName')

is_claude_pr="false"
if [[ "$author" == "claude[bot]" || "$head_branch" == claude/* ]]; then
  is_claude_pr="true"
fi

echo "is_claude_pr=$is_claude_pr" >> $GITHUB_OUTPUT`,
  });
}

/**
 * gh pr edit --remove-reviewer - Remove reviewer from PR
 * No outputs (action only)
 */
export function ghPrEditRemoveReviewer(env: {
  GH_TOKEN: string;
  PR_NUMBER: string;
  REVIEWERS: string;
}): Step {
  return new Step({
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
): Step {
  return new Step({
    id,
    name: "gh pr view (extended)",
    env,
    run: `# Determine how to find the PR
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
  echo "has_pr=false" >> $GITHUB_OUTPUT
  echo "is_claude_pr=false" >> $GITHUB_OUTPUT
  echo "is_draft=false" >> $GITHUB_OUTPUT
  echo "pr_number=" >> $GITHUB_OUTPUT
  echo "pr_head_branch=" >> $GITHUB_OUTPUT
  echo "has_issue=false" >> $GITHUB_OUTPUT
  echo "issue_number=" >> $GITHUB_OUTPUT
  {
    echo 'pr_body<<EOF'
    echo ''
    echo 'EOF'
  } >> $GITHUB_OUTPUT
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
echo "has_pr=true" >> $GITHUB_OUTPUT
echo "is_claude_pr=$is_claude_pr" >> $GITHUB_OUTPUT
echo "is_draft=$is_draft" >> $GITHUB_OUTPUT
echo "pr_number=$pr_number" >> $GITHUB_OUTPUT
echo "pr_head_branch=$head_branch" >> $GITHUB_OUTPUT
echo "has_issue=$has_issue" >> $GITHUB_OUTPUT
echo "issue_number=$issue_number" >> $GITHUB_OUTPUT
{
  echo 'pr_body<<EOF'
  echo "$body"
  echo 'EOF'
} >> $GITHUB_OUTPUT`,
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
export function ghDetectStalledReviews(env: {
  GH_TOKEN: string;
  DRY_RUN: string;
}): Step {
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

  return new Step({
    name: "Detect stalled review requests",
    env,
    run: script,
  });
}
