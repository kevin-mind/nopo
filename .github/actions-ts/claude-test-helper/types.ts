/**
 * Types for the Claude Test Helper action
 *
 * These types define the structure of test fixtures and expected outcomes
 * for state machine testing across all job types.
 */

/**
 * Project status values used in the state machine
 * NOTE: These must match the exact values in the GitHub Project
 */
export type ProjectStatus =
  | "Backlog"
  | "In progress"
  | "Ready"
  | "In review"
  | "Done"
  | "Blocked"
  | "Error";

/**
 * All job types supported by the Claude automation
 */
type JobType =
  | "issue-triage"
  | "issue-iterate"
  | "issue-orchestrate"
  | "issue-comment"
  | "pr-review"
  | "pr-response"
  | "pr-human-response"
  | "discussion-research"
  | "discussion-respond"
  | "discussion-summarize"
  | "discussion-plan";

/**
 * Configuration for a test parent issue
 */
export interface ParentIssueConfig {
  /** Issue title (will be prefixed with [TEST]) */
  title: string;
  /** Issue body content */
  body: string;
  /** Labels to add (test:automation will be added automatically) */
  labels?: string[];
  /** Project field values to set */
  project_fields?: {
    Status?: ProjectStatus;
    Iteration?: number;
    Failures?: number;
  };
}

/**
 * Configuration for a test sub-issue
 */
export interface SubIssueConfig {
  /** Sub-issue title (will be prefixed with [Phase N]) */
  title: string;
  /** Sub-issue body content */
  body: string;
  /** Project field values to set */
  project_fields?: {
    Status?: ProjectStatus;
    Iteration?: number;
    Failures?: number;
  };
}

/**
 * Configuration for a test branch
 */
export interface BranchConfig {
  /** Branch name (will be prefixed with test/) */
  name: string;
  /** Base branch to create from */
  from: string;
  /** Link the PR to the first sub-issue instead of the parent issue */
  link_to_sub_issue?: boolean;
  /** Commits to add to the branch */
  commits?: Array<{
    message: string;
    /** Map of file path to content. Supports {SUB_ISSUE_NUMBER} placeholder. */
    files: Record<string, string>;
  }>;
}

/**
 * Configuration for a test PR
 */
interface PullRequestConfig {
  /** PR title */
  title: string;
  /** PR body */
  body: string;
  /** Whether to create as draft */
  draft?: boolean;
  /** Request nopo-bot as reviewer (triggers pr-review) */
  request_review?: boolean;
}

/**
 * Configuration for a test comment
 */
interface CommentConfig {
  /** Comment body */
  body: string;
  /** Author login (default: current user) */
  author?: string;
}

/**
 * Configuration for a test discussion
 */
interface DiscussionConfig {
  /** Discussion title */
  title: string;
  /** Discussion body */
  body: string;
  /** Category slug (default: general) */
  category?: string;
}

/**
 * Configuration for a test review
 */
interface ReviewConfig {
  /** Review state: approve, request_changes, comment */
  state: "approve" | "request_changes" | "comment";
  /** Review body */
  body: string;
  /** Reviewer login (for human reviews) */
  reviewer?: string;
}

/**
 * Expected outcome after state machine runs
 */
export interface ExpectedOutcome {
  /** Expected parent issue project status */
  parent_status?: ProjectStatus;
  /** Expected sub-issue statuses (in order) */
  sub_issue_statuses?: ProjectStatus[];
  /** Expected PR state */
  pr_state?: "open" | "closed" | "merged" | "draft";
  /** Expected issue state */
  issue_state?: "open" | "closed";
  /** Expected iteration count (minimum) */
  min_iteration?: number;
  /** Expected failures count */
  failures?: number;
  /** Expected labels on issue */
  labels?: string[];
  /** Expected discussion comment count (minimum) */
  min_comments?: number;
  /** Whether all sub-issues should be closed */
  all_sub_issues_closed?: boolean;
  /** Whether all sub-issue todos (checkboxes) should be checked */
  sub_issues_todos_done?: boolean;
  /** Strings that should appear in the iteration history */
  history_contains?: string[];
  /** Whether each sub-issue should have a merged PR */
  sub_issues_have_merged_pr?: boolean;
}

/**
 * E2E outcomes configuration for test instrumentation
 * Specifies expected outcomes per iteration for CI, Release, and Review
 */
export interface E2EOutcomes {
  /** CI outcomes per iteration (e.g., ["failure", "success"]) */
  ci?: ("success" | "failure")[];
  /** Release/deploy outcomes per iteration */
  release?: ("success" | "failure")[];
  /** Review outcomes per iteration */
  review?: ("approved" | "changes_requested" | "comment")[];
}

/**
 * Complete test fixture configuration
 */
export interface TestFixture {
  /** Unique name for this test scenario */
  name: string;
  /** Description of what this test validates */
  description: string;
  /** Job type this fixture tests */
  job_type: JobType;

  /** Parent issue configuration (for issue-* jobs) */
  parent_issue?: ParentIssueConfig;
  /** Sub-issues (optional, for phased work) */
  sub_issues?: SubIssueConfig[];

  /** Branch configuration (optional) */
  branch?: BranchConfig;
  /** PR configuration (optional, for pr-* jobs) */
  pr?: PullRequestConfig;
  /** Comment configuration (for issue-comment) */
  comment?: CommentConfig;
  /** Discussion configuration (for discussion-* jobs) */
  discussion?: DiscussionConfig;
  /** Review configuration (for pr-response, pr-human-response) */
  review?: ReviewConfig;

  /** Expected outcome after state machine runs */
  expected?: ExpectedOutcome;
  /** Timeout in seconds for verification polling (default: 300) */
  timeout?: number;
  /** Poll interval in seconds for verification (default: 10) */
  poll_interval?: number;

  /**
   * E2E outcomes configuration for test instrumentation
   * Specifies expected outcomes per iteration for CI, Release, and Review
   * Used to control simulated CI/Release/Review behavior during e2e tests
   */
  e2e_outcomes?: E2EOutcomes;
}

/**
 * Result of fixture creation
 */
export interface FixtureCreationResult {
  /** Created parent issue number */
  issue_number: number;
  /** Created sub-issue numbers */
  sub_issue_numbers: number[];
  /** Created branch name (if any) */
  branch_name?: string;
  /** Created PR number (if any) */
  pr_number?: number;
  /** Created discussion number (if any) */
  discussion_number?: number;
  /** Created comment ID (if any) */
  comment_id?: string;
}

/**
 * Single verification error
 */
export interface VerificationError {
  /** What was being checked */
  field: string;
  /** Expected value */
  expected: string;
  /** Actual value */
  actual: string;
}

/**
 * Result of fixture verification
 */
export interface VerificationResult {
  /** Whether all checks passed */
  passed: boolean;
  /** List of errors (if any) */
  errors: VerificationError[];
}
