/**
 * TypeScript interfaces for step outputs.
 * These serve as documentation and type reference for step output shapes.
 *
 * Note: GitHub Actions outputs are always strings. These interfaces document
 * the semantic meaning of each output.
 */

// =============================================================================
// gh pr outputs
// =============================================================================

/** Outputs from ghPrList */
export interface GhPrListOutputs {
  /** PR number or empty string if not found */
  number: string;
  /** "true" | "false" | empty */
  is_draft: string;
  /** GitHub username of PR author */
  author: string;
  /** Branch name */
  head_branch: string;
  /** "true" if PR was found, "false" otherwise */
  found: string;
}

/** Outputs from ghPrView */
export interface GhPrViewOutputs {
  /** PR number */
  number: string;
  /** "true" | "false" */
  is_draft: string;
  /** GitHub username of PR author */
  author: string;
  /** Branch name */
  head_branch: string;
  /** PR body (multiline) */
  body: string;
}

// =============================================================================
// gh issue outputs
// =============================================================================

/** Outputs from ghIssueView */
export interface GhIssueViewOutputs {
  /** Issue title */
  title: string;
  /** Issue body (multiline) */
  body: string;
  /** JSON array of label names */
  labels: string;
}

/** Outputs from ghIssueViewHasLabel */
export interface GhIssueViewHasLabelOutputs {
  /** "true" if issue has the label, "false" otherwise */
  has_label: string;
}

/** Outputs from ghIssueComment */
export interface GhIssueCommentOutputs {
  /** Comment ID (numeric string) */
  comment_id: string;
}

// =============================================================================
// gh label outputs
// =============================================================================

/** Outputs from ghLabelList */
export interface GhLabelListOutputs {
  /** JSON array of label names */
  labels: string;
}

// =============================================================================
// gh api outputs
// =============================================================================

/** Outputs from ghApiGraphql */
export interface GhApiGraphqlOutputs {
  /** JSON result from GraphQL query */
  result: string;
}

/** Outputs from ghApiGet */
export interface GhApiGetOutputs {
  /** JSON result from REST API */
  result: string;
}

/** Outputs from ghApiCountComments */
export interface GhApiCountCommentsOutputs {
  /** Total count of comments (numeric string) */
  count: string;
}

/** Outputs from ghApiUnresolvedComments */
export interface GhApiUnresolvedCommentsOutputs {
  /** "true" if there are unresolved threads */
  has_unresolved: string;
  /** Count of unresolved threads (numeric string) */
  unresolved_count: string;
}

/** Outputs from ghPrViewExtended */
export interface GhPrViewExtendedOutputs {
  /** "true" if PR was found */
  has_pr: string;
  /** "true" if PR author is claude[bot] or branch starts with claude/ */
  is_claude_pr: string;
  /** "true" if PR is a draft */
  is_draft: string;
  /** PR number */
  pr_number: string;
  /** Branch name */
  pr_head_branch: string;
  /** PR body (multiline) */
  pr_body: string;
  /** "true" if PR body contains Fixes/Closes/Resolves #N */
  has_issue: string;
  /** Issue number extracted from PR body */
  issue_number: string;
}

// =============================================================================
// git outputs
// =============================================================================

/** Outputs from gitCheckoutBranch */
export interface GitCheckoutBranchOutputs {
  /** Branch name */
  name: string;
  /** "true" if branch already existed, "false" if newly created */
  existed: string;
}

/** Outputs from gitStatus */
export interface GitStatusOutputs {
  /** "true" if there are uncommitted changes */
  has_changes: string;
  /** "true" if working directory is clean */
  is_clean: string;
}

/** Outputs from gitDiff */
export interface GitDiffOutputs {
  /** Diff output (multiline) */
  diff: string;
  /** "true" if there are changes */
  has_changes: string;
}

// =============================================================================
// Output reference helpers
// =============================================================================

/**
 * Helper to create a step output reference.
 * @example stepOutput("get_pr", "number") => "${{ steps.get_pr.outputs.number }}"
 */
export function stepOutput(stepId: string, outputName: string): string {
  return `\${{ steps.${stepId}.outputs.${outputName} }}`;
}

/**
 * Helper to create a job output reference.
 * @example jobOutput("check-pr", "pr_number") => "${{ needs.check-pr.outputs.pr_number }}"
 */
export function jobOutput(jobId: string, outputName: string): string {
  return `\${{ needs.${jobId}.outputs.${outputName} }}`;
}
