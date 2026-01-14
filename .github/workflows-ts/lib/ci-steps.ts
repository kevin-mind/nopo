/**
 * Inline workflow steps for CI loop operations.
 * Replaces shell scripts with type-safe TypeScript step generators.
 */

import { Step } from "@github-actions-workflow-ts/lib";
import { ghApiGraphql, ghPrView, ghPrReady } from "./gh-cli";

// =============================================================================
// check-claude-comment-count.sh
// =============================================================================

/**
 * Check how many comments Claude has made on a PR to prevent infinite loops.
 * Fails if Claude has made more than MAX_COMMENTS (default 20).
 */
export function checkClaudeCommentCountStep(env: {
  GH_TOKEN: string;
  PR_NUMBER: string;
  MAX_COMMENTS?: string;
}): Step {
  const script = `
MAX_COMMENTS="\${MAX_COMMENTS:-20}"

# Count comments from claude[bot] on this PR
review_comments=$(gh api "/repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/comments" --jq '[.[] | select(.user.login == "claude[bot]")] | length')
issue_comments=$(gh api "/repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" --jq '[.[] | select(.user.login == "claude[bot]")] | length')
reviews=$(gh api "/repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER/reviews" --jq '[.[] | select(.user.login == "claude[bot]")] | length')

total=$((review_comments + issue_comments + reviews))
echo "Claude has made $total comments/reviews on PR #$PR_NUMBER"

if [[ "$total" -gt "$MAX_COMMENTS" ]]; then
  echo "::error::Claude has made over $MAX_COMMENTS comments on this PR. Stopping to prevent infinite loop."
  exit 1
fi
`.trim();

  return new Step({
    name: "Check Claude comment count",
    env: env as Record<string, string>,
    run: script,
  });
}

// =============================================================================
// check-unresolved-comments.sh
// =============================================================================

const QUERY_UNRESOLVED_COMMENTS = `
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
        }
      }
    }
  }
}
`.trim();

/**
 * Check for unresolved review comments on a PR.
 * Outputs: has_unresolved, unresolved_count
 */
export function checkUnresolvedCommentsStep(
  id: string,
  env: {
    GH_TOKEN: string;
    PR_NUMBER: string;
  },
): Step {
  const script = `
repo_name="\${GITHUB_REPOSITORY#*/}"

unresolved=$(${ghApiGraphql({
    query: QUERY_UNRESOLVED_COMMENTS,
    rawFields: {
      owner: "$GITHUB_REPOSITORY_OWNER",
      repo: "$repo_name",
    },
    fields: {
      pr: "$PR_NUMBER",
    },
  })})

# Count unresolved threads (excluding outdated ones)
unresolved_count=$(echo "$unresolved" | jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false and .isOutdated == false)] | length')

echo "Unresolved comment threads: $unresolved_count"

if [[ "$unresolved_count" -gt 0 ]]; then
  echo "has_unresolved=true" >> "$GITHUB_OUTPUT"
  echo "unresolved_count=$unresolved_count" >> "$GITHUB_OUTPUT"
else
  echo "has_unresolved=false" >> "$GITHUB_OUTPUT"
fi
`.trim();

  return new Step({
    name: "Check for unresolved comments",
    id,
    env: {
      ...env,
      GITHUB_REPOSITORY_OWNER: "${{ github.repository_owner }}",
    },
    run: script,
  });
}

// =============================================================================
// convert-pr-to-draft.sh
// =============================================================================

/**
 * Find and convert a PR to draft if it exists and is not already a draft.
 */
export function convertPRToDraftStep(env: {
  GH_TOKEN: string;
  HEAD_BRANCH: string;
}): Step {
  const script = `
# Find PR for this branch
pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --head "$HEAD_BRANCH" --json number,isDraft --jq '.[0]')

if [[ -z "$pr" || "$pr" == "null" ]]; then
  echo "No PR found for branch $HEAD_BRANCH"
  exit 0
fi

pr_number=$(echo "$pr" | jq -r '.number')
is_draft=$(echo "$pr" | jq -r '.isDraft')

if [[ "$is_draft" == "true" ]]; then
  echo "PR #$pr_number is already a draft"
  exit 0
fi

# Convert to draft
${ghPrReady({ pr: "$pr_number", undo: true })} --repo "$GITHUB_REPOSITORY"
echo "Converted PR #$pr_number to draft (push detected, CI will mark ready when green)"
`.trim();

  return new Step({
    name: "Find and convert PR to draft",
    env,
    run: script,
  });
}

// =============================================================================
// find-pr-for-branch.sh
// =============================================================================

/**
 * Find PR for a branch and output its details.
 * Outputs: has_pr, pr_number, pr_head_branch, is_draft, pr_body, is_claude_pr, has_issue, issue_number, conclusion
 */
export function findPRForBranchStep(
  id: string,
  env: {
    GH_TOKEN: string;
    HEAD_BRANCH: string;
    INPUT_PR_NUMBER?: string;
    INPUT_CONCLUSION?: string;
  },
): Step {
  const script = `
# Handle workflow_dispatch - get PR directly by number
if [[ -n "\${INPUT_PR_NUMBER:-}" ]]; then
  echo "Manual trigger for PR #$INPUT_PR_NUMBER"
  pr=$(${ghPrView({ pr: "$INPUT_PR_NUMBER", json: ["number", "author", "isDraft", "body", "headRefName"] })} --repo "$GITHUB_REPOSITORY")
  echo "conclusion=$INPUT_CONCLUSION" >> "$GITHUB_OUTPUT"
# Check if this is a merge queue branch (gh-readonly-queue/main/pr-NNN-...)
elif [[ "$HEAD_BRANCH" =~ ^gh-readonly-queue/.*/pr-([0-9]+)- ]]; then
  pr_number="\${BASH_REMATCH[1]}"
  echo "Merge queue branch detected, extracting PR #$pr_number"
  pr=$(${ghPrView({ pr: "$pr_number", json: ["number", "author", "isDraft", "body", "headRefName"] })} --repo "$GITHUB_REPOSITORY")
else
  # Find PR for this branch
  pr=$(gh pr list --repo "$GITHUB_REPOSITORY" --head "$HEAD_BRANCH" --json number,author,isDraft,body,headRefName --jq '.[0]')
fi

if [[ -z "$pr" || "$pr" == "null" ]]; then
  echo "No PR found for branch $HEAD_BRANCH"
  echo "has_pr=false" >> "$GITHUB_OUTPUT"
  exit 0
fi

pr_number=$(echo "$pr" | jq -r '.number')
author=$(echo "$pr" | jq -r '.author.login')
is_draft=$(echo "$pr" | jq -r '.isDraft')
pr_body=$(echo "$pr" | jq -r '.body')
pr_head_branch=$(echo "$pr" | jq -r '.headRefName')

echo "PR #$pr_number by $author (draft: $is_draft) on branch $pr_head_branch"
{
  echo "has_pr=true"
  echo "pr_number=$pr_number"
  echo "pr_head_branch=$pr_head_branch"
  echo "is_draft=$is_draft"
} >> "$GITHUB_OUTPUT"

# Store body for later use (heredoc style)
{
  echo "pr_body<<EOF"
  echo "$pr_body"
  echo "EOF"
} >> "$GITHUB_OUTPUT"

# Check if PR was created by Claude automation
if [[ "$author" == "claude[bot]" ]]; then
  echo "is_claude_pr=true" >> "$GITHUB_OUTPUT"
else
  echo "is_claude_pr=false" >> "$GITHUB_OUTPUT"
fi

# Extract linked issue from "Fixes #N" pattern
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
    name: "Find PR and check details",
    id,
    env: env as Record<string, string>,
    run: script,
  });
}
