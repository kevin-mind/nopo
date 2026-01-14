/**
 * Inline workflow steps for issue loop operations.
 * Replaces shell scripts with type-safe TypeScript step generators.
 */

import { Step } from "@github-actions-workflow-ts/lib";
import { ghApiGraphql, ghIssueEdit, ghIssueView, ghPrView } from "./gh-cli";

// =============================================================================
// check-sub-issue.sh
// =============================================================================

const QUERY_ISSUE_PARENT = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      parent { number }
    }
  }
}
`.trim();

/**
 * Check if issue is a sub-issue and should skip triage.
 * Outputs: should_triage, issue_number, issue_title, issue_body
 */
export function checkSubIssueStep(
  id: string,
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
  },
): Step {
  const script = `
echo "issue_number=$ISSUE_NUMBER" >> $GITHUB_OUTPUT

# Get issue details (needed for workflow_dispatch which doesn't have issue context)
issue_data=$(${ghIssueView({ issue: "$ISSUE_NUMBER", json: ["title", "body"] })})
issue_title=$(echo "$issue_data" | jq -r '.title')
echo "issue_title=$issue_title" >> $GITHUB_OUTPUT

# Store body in a file to handle multiline content
echo "$issue_data" | jq -r '.body' > /tmp/issue_body.txt
{
  echo 'issue_body<<EOF'
  cat /tmp/issue_body.txt
  echo 'EOF'
} >> $GITHUB_OUTPUT

# Check 1: Title starts with [Sub] - this catches sub-issues immediately
if [[ "$issue_title" == "[Sub]"* ]]; then
  echo "Issue #$ISSUE_NUMBER has [Sub] prefix - skipping triage"
  echo "should_triage=false" >> $GITHUB_OUTPUT
  exit 0
fi

# Check 2: Issue has a parent (is already linked as sub-issue)
parent=$(${ghApiGraphql({
    query: QUERY_ISSUE_PARENT,
    rawFields: {
      owner: "$GITHUB_REPOSITORY_OWNER",
      repo: "${GITHUB_REPOSITORY#*/}",
    },
    fields: {
      number: "$ISSUE_NUMBER",
    },
    headers: {
      "GraphQL-Features": "sub_issues",
    },
    jq: ".data.repository.issue.parent.number // empty",
  })} 2>/dev/null || echo "")

if [[ -n "$parent" ]]; then
  echo "Issue #$ISSUE_NUMBER is a sub-issue of #$parent - skipping triage"
  echo "should_triage=false" >> $GITHUB_OUTPUT
else
  echo "Issue #$ISSUE_NUMBER is not a sub-issue - proceeding with triage"
  echo "should_triage=true" >> $GITHUB_OUTPUT
fi
`.trim();

  return new Step({
    name: "Check if sub-issue",
    id,
    env: {
      ...env,
      GITHUB_REPOSITORY_OWNER: "${{ github.repository_owner }}",
    },
    run: script,
  });
}

// =============================================================================
// check-triaged-label.sh
// =============================================================================

/**
 * Check if issue has the triaged label before allowing implementation.
 * Exits with error if label is missing.
 */
export function checkTriagedLabelStep(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
}): Step {
  const script = `
has_triaged=$(${ghIssueView({ issue: "$ISSUE_NUMBER", json: ["labels"], jq: ".labels[].name" })} | grep -c "^triaged$" || true)

if [[ "$has_triaged" -eq 0 ]]; then
  gh issue comment "$ISSUE_NUMBER" --body "⚠️ Cannot start implementation - issue is missing the \\\`triaged\\\` label.

Please wait for triage to complete or manually add the \\\`triaged\\\` label, then re-assign nopo-bot."
  ${ghIssueEdit({ issue: "$ISSUE_NUMBER", removeAssignees: ["nopo-bot"] })}
  echo "::error::Issue #$ISSUE_NUMBER is missing 'triaged' label"
  exit 1
fi
`.trim();

  return new Step({
    name: "Check triaged label",
    env,
    run: script,
  });
}

// =============================================================================
// check-project-status-for-impl.sh
// =============================================================================

const QUERY_PROJECT_STATUS = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
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
`.trim();

/**
 * Check if project status allows implementation (Ready or In progress).
 * Exits with error if status doesn't allow implementation.
 */
export function checkProjectStatusForImplStep(env: {
  GH_TOKEN: string;
  ISSUE_NUMBER: string;
}): Step {
  const script = `
repo_name="\${GITHUB_REPOSITORY#*/}"

result=$(${ghApiGraphql({
    query: QUERY_PROJECT_STATUS,
    rawFields: {
      owner: "$GITHUB_REPOSITORY_OWNER",
      repo: "$repo_name",
    },
    fields: {
      number: "$ISSUE_NUMBER",
    },
  })} 2>/dev/null || echo '{}')

status=$(echo "$result" | jq -r '.data.repository.issue.projectItems.nodes[0].fieldValueByName.name // empty')

if [[ -z "$status" ]]; then
  echo "Issue not linked to a project - skipping status check"
elif [[ "$status" == "Ready" || "$status" == "In progress" ]]; then
  echo "Issue status '$status' allows implementation - proceeding"
else
  gh issue comment "$ISSUE_NUMBER" --body "⚠️ Cannot start implementation - issue status is **$status**.

Implementation requires status to be **Ready** or **In progress**.
Please move the issue to **Ready** status in the project board, then re-assign nopo-bot."
  ${ghIssueEdit({ issue: "$ISSUE_NUMBER", removeAssignees: ["nopo-bot"] })}
  echo "::error::Issue #$ISSUE_NUMBER status is '$status', must be Ready or In progress"
  exit 1
fi
`.trim();

  return new Step({
    name: "Check project status allows implementation",
    env: {
      ...env,
      GITHUB_REPOSITORY_OWNER: "${{ github.repository_owner }}",
    },
    run: script,
  });
}

// =============================================================================
// get-pr-branch.sh
// =============================================================================

/**
 * Get PR branch for comment response.
 * Outputs: branch, is_pr
 */
export function getPRBranchStep(
  id: string,
  env: {
    GH_TOKEN: string;
    IS_PR: string;
    PR_NUMBER: string;
  },
): Step {
  const script = `
if [[ "$IS_PR" == "true" ]]; then
  pr_branch=$(${ghPrView({ pr: "$PR_NUMBER", json: ["headRefName"], jq: ".headRefName" })} --repo "$GITHUB_REPOSITORY")
  echo "branch=$pr_branch" >> $GITHUB_OUTPUT
  echo "is_pr=true" >> $GITHUB_OUTPUT
  echo "Detected PR comment on branch: $pr_branch"
else
  echo "branch=main" >> $GITHUB_OUTPUT
  echo "is_pr=false" >> $GITHUB_OUTPUT
  echo "Detected issue comment, using main branch"
fi
`.trim();

  return new Step({
    name: "Get PR branch (if PR comment)",
    id,
    env,
    run: script,
  });
}

// =============================================================================
// salvage-partial-progress.sh
// =============================================================================

/**
 * Salvage partial progress by committing and pushing any uncommitted changes.
 */
export function salvagePartialProgressStep(
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
    JOB_STATUS: string;
    BRANCH_NAME: string;
    GITHUB_SERVER_URL: string;
    GITHUB_REPOSITORY: string;
  },
  ifCondition?: string,
): Step {
  const script = `
# Check if there are uncommitted changes
if ! git diff --quiet HEAD 2>/dev/null; then
  echo "Uncommitted changes detected - salvaging partial progress"

  git add -A
  git commit -m "WIP: Partial implementation of #$ISSUE_NUMBER

Implementation was interrupted ($JOB_STATUS).
See issue comments for details on what was completed."

  git push origin HEAD

  # Comment on issue explaining partial progress
  gh issue comment "$ISSUE_NUMBER" --body "⚠️ **Implementation partially completed**

The job was interrupted before finishing. Progress has been saved to branch \\\`$BRANCH_NAME\\\`.

**Next steps:**
- Review the partial changes on the branch
- Re-assign nopo-bot to continue implementation

[View partial work](\${GITHUB_SERVER_URL}/\${GITHUB_REPOSITORY}/compare/main...$BRANCH_NAME)"
else
  echo "No uncommitted changes to salvage"
fi
`.trim();

  return new Step({
    name: "Salvage partial progress",
    ...(ifCondition && { if: ifCondition }),
    env,
    run: script,
  });
}

// =============================================================================
// unassign-nopo-bot.sh
// =============================================================================

/**
 * Unassign nopo-bot from an issue on failure.
 */
export function unassignNopoBotStep(
  env: {
    GH_TOKEN: string;
    ISSUE_NUMBER: string;
  },
  ifCondition?: string,
): Step {
  return new Step({
    name: "Unassign nopo-bot on failure",
    ...(ifCondition && { if: ifCondition }),
    env,
    run: `echo "Implementation failed - unassigning nopo-bot from issue #$ISSUE_NUMBER"
${ghIssueEdit({ issue: "$ISSUE_NUMBER", removeAssignees: ["nopo-bot"] })}`,
  });
}
