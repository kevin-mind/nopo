import { Step } from "@github-actions-workflow-ts/lib";

/**
 * Type-safe inline step generators for common GitHub CLI operations.
 * These generate bash commands inline rather than calling external scripts,
 * providing better type safety and deduplication.
 */

// =============================================================================
// GITHUB GRAPHQL API HELPERS
// =============================================================================

/**
 * Get project item info for an issue (project ID, item ID)
 * Outputs: item_id, project_id
 */
export function getProjectItemStep(
  id: string,
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
  },
): Step {
  const script = `
repo_name="\${GITHUB_REPOSITORY#*/}"

result=$(gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 10) {
          nodes { id project { id } }
        }
      }
    }
  }
' -f owner="$GITHUB_REPOSITORY_OWNER" -f repo="$repo_name" -F number="$ISSUE_NUMBER")

item_id=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0].id // empty')
project_id=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0].project.id // empty')

if [[ -z "$item_id" || "$item_id" == "null" ]]; then
  echo "Issue #$ISSUE_NUMBER not linked to any project"
  echo "has_project=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "has_project=true" >> "$GITHUB_OUTPUT"
echo "item_id=$item_id" >> "$GITHUB_OUTPUT"
echo "project_id=$project_id" >> "$GITHUB_OUTPUT"
`.trim();

  return new Step({
    name: "Get project item",
    id,
    env: {
      ...env,
      GITHUB_REPOSITORY_OWNER: "${{ github.repository_owner }}",
    },
    run: script,
  });
}

/**
 * Get Status field ID and option IDs from a project
 * Outputs: field_id, option_id (for the target status)
 */
export function getProjectStatusFieldStep(
  id: string,
  env: {
    GH_TOKEN: string;
    PROJECT_ID: string;
    TARGET_STATUS: string;
  },
): Step {
  const script = `
fields=$(gh api graphql -f query='
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 20) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
      }
    }
  }
' -f projectId="$PROJECT_ID")

field_id=$(echo "$fields" | jq -r '.data.node.fields.nodes[] | select(.name == "Status") | .id')
option_id=$(echo "$fields" | jq -r --arg status "$TARGET_STATUS" '.data.node.fields.nodes[] | select(.name == "Status") | .options[] | select(.name == $status) | .id')

if [[ -z "$field_id" || -z "$option_id" ]]; then
  echo "Could not find Status field or '$TARGET_STATUS' option"
  echo "has_field=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "has_field=true" >> "$GITHUB_OUTPUT"
echo "field_id=$field_id" >> "$GITHUB_OUTPUT"
echo "option_id=$option_id" >> "$GITHUB_OUTPUT"
`.trim();

  return new Step({
    name: `Get Status field for '${env.TARGET_STATUS}'`,
    id,
    env,
    run: script,
  });
}

/**
 * Update a project item's single-select field value
 */
export function updateProjectFieldStep(env: {
  GH_TOKEN: string;
  PROJECT_ID: string;
  ITEM_ID: string;
  FIELD_ID: string;
  OPTION_ID: string;
}): Step {
  const script = `
gh api graphql -f query='
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }
    ) { projectV2Item { id } }
  }
' -f projectId="$PROJECT_ID" -f itemId="$ITEM_ID" -f fieldId="$FIELD_ID" -f optionId="$OPTION_ID"
`.trim();

  return new Step({
    name: "Update project field",
    env,
    run: script,
  });
}

/**
 * Combined step: Update project item status (get item, get field, update)
 * This is the most common pattern - a single step that does all three
 */
export function updateProjectStatusStep(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  TARGET_STATUS: string;
}): Step {
  const script = `
repo_name="\${GITHUB_REPOSITORY#*/}"

# Get the issue's project item
issue_data=$(gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        id
        projectItems(first: 10) {
          nodes {
            id
            project { id }
          }
        }
      }
    }
  }
' -f owner="$GITHUB_REPOSITORY_OWNER" -f repo="$repo_name" -F number="$ISSUE_NUMBER")

item_id=$(echo "$issue_data" | jq -r '.data.repository.issue.projectItems.nodes[0].id // empty')
project_id=$(echo "$issue_data" | jq -r '.data.repository.issue.projectItems.nodes[0].project.id // empty')

if [[ -z "$item_id" || "$item_id" == "null" ]]; then
  echo "Issue #$ISSUE_NUMBER not linked to any project"
  exit 0
fi

echo "Found project item: $item_id in project: $project_id"

# Get Status field and target option IDs
fields=$(gh api graphql -f query='
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 20) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
      }
    }
  }
' -f projectId="$project_id")

field_id=$(echo "$fields" | jq -r '.data.node.fields.nodes[] | select(.name == "Status") | .id')
option_id=$(echo "$fields" | jq -r --arg status "$TARGET_STATUS" '.data.node.fields.nodes[] | select(.name == "Status") | .options[] | select(.name == $status) | .id')

if [[ -z "$field_id" || -z "$option_id" ]]; then
  echo "Could not find Status field or '$TARGET_STATUS' option"
  exit 0
fi

# Update to target status
gh api graphql -f query='
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }
    ) { projectV2Item { id } }
  }
' -f projectId="$project_id" -f itemId="$item_id" -f fieldId="$field_id" -f optionId="$option_id"

echo "Updated issue #$ISSUE_NUMBER to '$TARGET_STATUS' status"
`.trim();

  return new Step({
    name: `Update project status to '${env.TARGET_STATUS}'`,
    env: {
      ...env,
      GITHUB_REPOSITORY_OWNER: "${{ github.repository_owner }}",
    },
    run: script,
  });
}

// =============================================================================
// ISSUE/PR COMMENT HELPERS
// =============================================================================

/**
 * Add a comment to an issue or PR
 * Outputs: comment_id
 */
export function issueCommentStep(
  id: string,
  env: {
    GH_TOKEN: string;
    NUMBER: string;
    BODY: string;
  },
): Step {
  const script = `
comment_url=$(gh issue comment "$NUMBER" --body "$BODY" 2>&1) || { echo "Failed to post comment: $comment_url"; exit 1; }

# Extract comment ID from URL (format: ...#issuecomment-ID)
comment_id=$(echo "$comment_url" | grep -oP 'issuecomment-\\K\\d+' || true)
echo "comment_id=$comment_id" >> "$GITHUB_OUTPUT"

if [[ -z "$comment_id" ]]; then
  echo "Warning: Comment ID not extracted, but comment was posted"
  echo "$comment_url"
fi
`.trim();

  return new Step({
    name: "Add comment",
    id,
    env,
    run: script,
  });
}

/**
 * Add a bot status comment with a link to the job
 * Outputs: comment_id
 */
export function botStatusCommentStep(
  id: string,
  env: {
    GH_TOKEN: string;
    NUMBER: string;
    MESSAGE: string;
    RUN_URL: string;
  },
): Step {
  const script = `
full_body="$MESSAGE

[View job]($RUN_URL)"

comment_url=$(gh issue comment "$NUMBER" --body "$full_body" 2>&1) || { echo "Failed to post comment: $comment_url"; exit 1; }

# Extract comment ID from URL
comment_id=$(echo "$comment_url" | grep -oP 'issuecomment-\\K\\d+' || true)
echo "comment_id=$comment_id" >> "$GITHUB_OUTPUT"

if [[ -z "$comment_id" ]]; then
  echo "Warning: Comment ID not extracted"
fi
`.trim();

  return new Step({
    name: "Add bot status comment",
    id,
    env,
    run: script,
  });
}

/**
 * Add a reaction to a comment
 */
export function addReactionStep(
  env: {
    GH_TOKEN: string;
    COMMENT_ID: string;
    REACTION:
      | "rocket"
      | "eyes"
      | "+1"
      | "-1"
      | "laugh"
      | "confused"
      | "heart"
      | "hooray";
  },
  opts?: { if?: string },
): Step {
  const script = `
gh api "repos/$GITHUB_REPOSITORY/issues/comments/$COMMENT_ID/reactions" -f content="$REACTION"
echo "Added $REACTION reaction to comment #$COMMENT_ID"
`.trim();

  return new Step({
    name: `Add ${env.REACTION} reaction`,
    ...(opts?.if && { if: opts.if }),
    env,
    run: script,
  });
}

// =============================================================================
// ISSUE/PR QUERY HELPERS
// =============================================================================

/**
 * Get PR details by branch name
 * Outputs: has_pr, pr_number, is_draft, author, head_ref, pr_body
 */
export function getPRByBranchStep(
  id: string,
  env: {
    GH_TOKEN: string;
    HEAD_BRANCH: string;
  },
): Step {
  const script = `
# Check for merge queue branch pattern
if [[ "$HEAD_BRANCH" =~ ^gh-readonly-queue/.*/pr-([0-9]+)- ]]; then
  pr_number="\${BASH_REMATCH[1]}"
  echo "Merge queue branch detected, extracting PR #$pr_number"
  pr=$(gh pr view "$pr_number" --json number,author,isDraft,body,headRefName)
else
  pr=$(gh pr list --head "$HEAD_BRANCH" --json number,author,isDraft,body,headRefName --jq '.[0]')
fi

if [[ -z "$pr" || "$pr" == "null" ]]; then
  echo "No PR found for branch $HEAD_BRANCH"
  echo "has_pr=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "has_pr=true" >> "$GITHUB_OUTPUT"
echo "pr_number=$(echo "$pr" | jq -r '.number')" >> "$GITHUB_OUTPUT"
echo "is_draft=$(echo "$pr" | jq -r '.isDraft')" >> "$GITHUB_OUTPUT"
echo "author=$(echo "$pr" | jq -r '.author.login')" >> "$GITHUB_OUTPUT"
echo "head_ref=$(echo "$pr" | jq -r '.headRefName')" >> "$GITHUB_OUTPUT"

{
  echo "pr_body<<EOF"
  echo "$pr" | jq -r '.body'
  echo "EOF"
} >> "$GITHUB_OUTPUT"
`.trim();

  return new Step({
    name: "Get PR by branch",
    id,
    env,
    run: script,
  });
}

/**
 * Check if a PR exists for an issue (searches for "Fixes #N" in PR body)
 * Outputs: has_pr, pr_number
 */
export function checkPRForIssueStep(
  id: string,
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
  },
): Step {
  const script = `
existing_pr=$(gh pr list --search "Fixes #$ISSUE_NUMBER in:body" --json number --jq '.[0].number' || true)

if [[ -n "$existing_pr" && "$existing_pr" != "null" ]]; then
  echo "PR #$existing_pr already exists for issue #$ISSUE_NUMBER"
  echo "has_pr=true" >> "$GITHUB_OUTPUT"
  echo "pr_number=$existing_pr" >> "$GITHUB_OUTPUT"
else
  echo "No existing PR found for issue #$ISSUE_NUMBER"
  echo "has_pr=false" >> "$GITHUB_OUTPUT"
fi
`.trim();

  return new Step({
    name: "Check for existing PR",
    id,
    env,
    run: script,
  });
}

/**
 * Get issue body with recent comments
 * Outputs: body (multiline)
 */
export function getIssueWithCommentsStep(
  id: string,
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
  },
  opts?: { commentCount?: number },
): Step {
  const commentCount = opts?.commentCount ?? 10;
  const script = `
# Get issue body
gh issue view "$ISSUE_NUMBER" --json body --jq '.body' > /tmp/issue_body.txt

# Get recent comments for context
gh issue view "$ISSUE_NUMBER" --json comments \\
  --jq '.comments[-${commentCount}:] | .[] | "---\\n**\\(.author.login)** (\\(.createdAt)):\\n\\(.body)\\n"' \\
  > /tmp/issue_comments.txt || true

# Combine body and comments
echo "body<<EOF" >> "$GITHUB_OUTPUT"
cat /tmp/issue_body.txt >> "$GITHUB_OUTPUT"
if [[ -s /tmp/issue_comments.txt ]]; then
  echo "" >> "$GITHUB_OUTPUT"
  echo "## Recent Comments" >> "$GITHUB_OUTPUT"
  cat /tmp/issue_comments.txt >> "$GITHUB_OUTPUT"
fi
echo "EOF" >> "$GITHUB_OUTPUT"
`.trim();

  return new Step({
    name: "Get issue with comments",
    id,
    env,
    run: script,
  });
}

// =============================================================================
// ISSUE/PR EDIT HELPERS
// =============================================================================

/**
 * Add labels to an issue
 */
export function addIssueLabelsStep(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  LABELS: string; // comma-separated
}): Step {
  return new Step({
    name: "Add labels",
    env,
    run: `gh issue edit "$ISSUE_NUMBER" --add-label "$LABELS"`,
  });
}

/**
 * Remove labels from an issue
 */
export function removeIssueLabelsStep(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  LABELS: string; // comma-separated
}): Step {
  return new Step({
    name: "Remove labels",
    env,
    run: `gh issue edit "$ISSUE_NUMBER" --remove-label "$LABELS"`,
  });
}

/**
 * Add assignees to an issue
 */
export function addIssueAssigneesStep(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  ASSIGNEES: string; // comma-separated
}): Step {
  return new Step({
    name: "Add assignees",
    env,
    run: `gh issue edit "$ISSUE_NUMBER" --add-assignee "$ASSIGNEES"`,
  });
}

/**
 * Remove assignees from an issue
 */
export function removeIssueAssigneesStep(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
  ASSIGNEES: string; // comma-separated
}): Step {
  return new Step({
    name: "Remove assignees",
    env,
    run: `gh issue edit "$ISSUE_NUMBER" --remove-assignee "$ASSIGNEES"`,
  });
}

/**
 * Convert PR to draft
 */
export function convertPRToDraftStep(env: {
  GH_TOKEN: string;
  PR_NUMBER: string;
}): Step {
  return new Step({
    name: "Convert PR to draft",
    env,
    run: `gh pr ready "$PR_NUMBER" --undo`,
  });
}

/**
 * Mark PR ready for review
 */
export function markPRReadyStep(env: {
  GH_TOKEN: string;
  PR_NUMBER: string;
}): Step {
  return new Step({
    name: "Mark PR ready for review",
    env,
    run: `gh pr ready "$PR_NUMBER"`,
  });
}

/**
 * Request reviewers on a PR
 */
export function requestPRReviewersStep(env: {
  GH_TOKEN: string;
  PR_NUMBER: string;
  REVIEWERS: string; // comma-separated
}): Step {
  return new Step({
    name: "Request reviewers",
    env,
    run: `gh pr edit "$PR_NUMBER" --add-reviewer "$REVIEWERS"`,
  });
}

// =============================================================================
// GIT HELPERS
// =============================================================================

/**
 * Configure git for Claude bot commits
 */
export const configureGitStep = new Step({
  name: "Configure Git",
  run: `git config --global user.name "Claude Bot"
git config --global user.email "claude-bot@anthropic.com"`,
});

/**
 * Create or checkout a branch
 * Outputs: branch_existed (true if branch already existed)
 */
export function createOrCheckoutBranchStep(
  id: string,
  env: { BRANCH_NAME: string },
): Step {
  const script = `
git fetch origin || true

if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH_NAME"; then
  echo "Branch exists on remote, checking out..."
  git checkout "$BRANCH_NAME"
  git pull origin "$BRANCH_NAME" || true
  echo "branch_existed=true" >> "$GITHUB_OUTPUT"
elif git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  echo "Branch exists locally, checking out..."
  git checkout "$BRANCH_NAME"
  echo "branch_existed=true" >> "$GITHUB_OUTPUT"
else
  echo "Creating new branch: $BRANCH_NAME"
  git checkout -b "$BRANCH_NAME"
  echo "branch_existed=false" >> "$GITHUB_OUTPUT"
fi
`.trim();

  return new Step({
    name: "Create or checkout branch",
    id,
    env,
    run: script,
  });
}

// =============================================================================
// CLAUDE BOT SPECIFIC HELPERS
// =============================================================================

/**
 * Check if a PR was created by Claude
 * Outputs: is_claude_pr
 */
export function checkClaudePRStep(
  id: string,
  env: {
    GH_TOKEN: string;
    PR_NUMBER: string;
  },
): Step {
  const script = `
author=$(gh pr view "$PR_NUMBER" --json author --jq '.author.login')

if [[ "$author" == "claude[bot]" ]]; then
  echo "is_claude_pr=true" >> "$GITHUB_OUTPUT"
else
  echo "is_claude_pr=false" >> "$GITHUB_OUTPUT"
fi
`.trim();

  return new Step({
    name: "Check if Claude PR",
    id,
    env,
    run: script,
  });
}

/**
 * Extract linked issue from PR body ("Fixes #N" pattern)
 * Outputs: has_issue, issue_number
 */
export function extractLinkedIssueStep(
  id: string,
  env: {
    GH_TOKEN: string;
    PR_NUMBER: string;
  },
): Step {
  const script = `
pr_body=$(gh pr view "$PR_NUMBER" --json body --jq '.body')
issue_number=$(echo "$pr_body" | grep -oP 'Fixes #\\K\\d+' | head -1 || true)

if [[ -z "$issue_number" ]]; then
  echo "No linked issue found in PR body"
  echo "has_issue=false" >> "$GITHUB_OUTPUT"
else
  echo "Found linked issue #$issue_number"
  echo "has_issue=true" >> "$GITHUB_OUTPUT"
  echo "issue_number=$issue_number" >> "$GITHUB_OUTPUT"
fi
`.trim();

  return new Step({
    name: "Extract linked issue",
    id,
    env,
    run: script,
  });
}

/**
 * Check Claude bot comment count on a PR (for rate limiting)
 * Outputs: comment_count, should_continue
 */
export function checkClaudeCommentCountStep(
  id: string,
  env: {
    GH_TOKEN: string;
    PR_NUMBER: string;
  },
  opts?: { maxComments?: number },
): Step {
  const maxComments = opts?.maxComments ?? 10;
  const script = `
comment_count=$(gh api "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" \\
  --jq '[.[] | select(.user.login == "claude[bot]" or .user.login == "nopo-bot")] | length')

echo "Claude comment count: $comment_count"
echo "comment_count=$comment_count" >> "$GITHUB_OUTPUT"

if [[ "$comment_count" -ge ${maxComments} ]]; then
  echo "Too many Claude comments ($comment_count >= ${maxComments}), stopping"
  echo "should_continue=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "should_continue=true" >> "$GITHUB_OUTPUT"
`.trim();

  return new Step({
    name: "Check Claude comment count",
    id,
    env,
    run: script,
  });
}
