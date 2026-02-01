/**
 * Types for claude-test-runner
 */

import type {
  MachineContext,
  ProjectStatus,
} from "../../claude-state-machine/schemas/index.js";

/**
 * Configuration for the exponential backoff poller
 */
export interface PollerConfig {
  /** Initial poll interval in milliseconds (default: 5000) */
  initialIntervalMs: number;
  /** Maximum poll interval in milliseconds (default: 60000) */
  maxIntervalMs: number;
  /** Multiplier for exponential backoff (default: 1.5) */
  multiplier: number;
  /** Jitter factor for randomization (default: 0.1) */
  jitterFactor: number;
  /** Total timeout in milliseconds */
  timeoutMs: number;
}

/**
 * Result from polling operation
 */
export interface PollResult<T> {
  /** Whether the condition was met before timeout */
  success: boolean;
  /** The final data from the fetch function */
  data: T | null;
  /** Number of poll attempts made */
  attempts: number;
  /** Total time spent polling in milliseconds */
  totalTimeMs: number;
  /** Whether polling was cancelled via signal */
  cancelled?: boolean;
}

/**
 * State predicted by the state machine
 */
export interface PredictedState {
  /** Expected machine state name (e.g., "iterating", "reviewing") */
  expectedState: string;
  /** Expected project status after actions complete */
  expectedStatus: ProjectStatus | null;
  /** Events that could trigger the next transition */
  triggersNeeded: string[];
  /** Estimated wait time in milliseconds */
  estimatedWaitMs: number;
  /** Description of what the machine will do */
  description: string;
}

/**
 * Result of guard evaluation for diagnostics
 */
export interface GuardResult {
  /** Guard name */
  name: string;
  /** Whether the guard passed */
  passed: boolean;
  /** Whether this guard was expected to pass */
  expected: boolean;
  /** Reason for the result */
  reason: string;
  /** Suggested fix if guard failed unexpectedly */
  fix: string | null;
}

/**
 * Workflow run information for diagnostics
 */
export interface WorkflowRun {
  /** Workflow run ID */
  id: number;
  /** Workflow name */
  name: string;
  /** Display title */
  displayTitle: string;
  /** Run status: queued, in_progress, completed */
  status: "queued" | "in_progress" | "completed";
  /** Conclusion if completed: success, failure, cancelled, etc. */
  conclusion: string | null;
  /** URL to the workflow run */
  url: string;
  /** When the run was created */
  createdAt: string;
  /** When the run was last updated */
  updatedAt: string;
  /** Head SHA for the run */
  headSha: string;
  /** Branch name */
  branch: string | null;
}

/**
 * Current GitHub state fetched from the API
 */
export interface GitHubState {
  /** Issue number */
  issueNumber: number;
  /** Issue state (OPEN or CLOSED) */
  issueState: "OPEN" | "CLOSED";
  /** Project status */
  projectStatus: ProjectStatus | null;
  /** Iteration count */
  iteration: number;
  /** Failure count */
  failures: number;
  /** Whether nopo-bot is assigned */
  botAssigned: boolean;
  /** Issue labels */
  labels: string[];
  /** Number of unchecked todos */
  uncheckedTodos: number;
  /** PR state if exists */
  prState: "OPEN" | "CLOSED" | "MERGED" | "DRAFT" | null;
  /** PR number if exists */
  prNumber: number | null;
  /** PR labels if exists */
  prLabels: string[];
  /** Branch name */
  branch: string | null;
  /** Whether branch exists */
  branchExists: boolean;
  /** Latest commit SHA */
  latestSha: string | null;
  /** Full machine context */
  context: MachineContext | null;
}

/**
 * Diagnosis result when test fails
 */
export interface Diagnosis {
  /** Overall status */
  status: "done" | "timeout" | "error";
  /** Actionable fix suggestion */
  suggestedFix: string;
  /** Detailed diagnosis message */
  diagnosis: string;
  /** Additional details */
  details: {
    expectedState: string;
    actualState: string;
    expectedStatus: ProjectStatus | null;
    actualStatus: ProjectStatus | null;
    guardsEvaluated: GuardResult[];
    workflowStatus: "running" | "waiting" | "failed" | "not_triggered";
    workflowRuns: WorkflowRun[];
  };
}

/**
 * Result from a single phase of testing
 */
export interface PhaseResult {
  /** Phase number */
  phase: number;
  /** Starting state */
  startState: string;
  /** Ending state */
  endState: string;
  /** Whether the phase completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Final test result
 */
export interface TestResult {
  /** Overall status */
  status: "done" | "timeout" | "error";
  /** Suggested fix if failed */
  suggestedFix?: string;
  /** Diagnosis details if failed */
  diagnosis?: string;
  /** Phases completed */
  phases: PhaseResult[];
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Issue number */
  issueNumber: number;
}

/**
 * Expected triage verification results
 */
export interface TriageExpectation {
  /** Labels expected after triage (e.g., ["triaged", "enhancement", "P1"]) */
  labels?: string[];
  /** Project fields expected after triage */
  project_fields?: {
    /** Priority field (e.g., "P0", "P1", "P2") */
    Priority?: string;
    /** Size field (e.g., "XS", "S", "M", "L", "XL") */
    Size?: string;
    /** Estimate in hours (Fibonacci: 1, 2, 3, 5, 8, 13, 21) */
    Estimate?: number;
    /** Status should be "Backlog" after triage */
    Status?: string;
  };
  /** Number of sub-issues expected to be created */
  sub_issue_count?: number;
}

/**
 * Expected phase verification results
 */
export interface PhaseExpectation {
  /** Expected branch name pattern (can include {N} for issue number) */
  branch_pattern?: string;
  /** Expected PR title contains this string */
  pr_title_contains?: string;
  /** Whether CI must pass for this phase */
  ci_required?: boolean;
  /** Whether review approval is required for this phase */
  review_required?: boolean;
  /** Whether deploy to staging is required */
  deploy_required?: boolean;
}

/**
 * Expected completion state
 */
interface CompletionExpectation {
  /** Expected parent issue status after all phases complete */
  parent_status?: string;
  /** Whether all sub-issues should be closed */
  all_sub_issues_closed?: boolean;
  /** Whether all PRs should be merged */
  all_prs_merged?: boolean;
}

/**
 * Triage wait result
 */
export interface TriageResult {
  /** Whether triage completed successfully */
  success: boolean;
  /** Labels found on the issue */
  labels: string[];
  /** Project fields found */
  project_fields: {
    Priority?: string;
    Size?: string;
    Estimate?: number;
    Status?: string;
  };
  /** Number of sub-issues found */
  sub_issue_count: number;
  /** Errors encountered during verification */
  errors: string[];
  /** Total time spent waiting in ms */
  duration_ms: number;
}

/**
 * Phase wait result
 */
export interface PhaseResult {
  /** Phase number */
  phase: number;
  /** Starting state */
  startState: string;
  /** Ending state */
  endState: string;
  /** Whether the phase completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Detailed phase wait result
 */
export interface PhaseWaitResult {
  /** Whether phase completed successfully */
  success: boolean;
  /** Branch name if created */
  branch_name: string | null;
  /** PR number if opened */
  pr_number: number | null;
  /** Current PR state */
  pr_state: "draft" | "open" | "merged" | "closed" | null;
  /** CI check status */
  ci_status: "pending" | "success" | "failure" | null;
  /** Review status */
  review_status: "pending" | "approved" | "changes_requested" | null;
  /** Issue state */
  issue_state: "open" | "closed";
  /** Project status of the issue */
  issue_status: string | null;
  /** Errors encountered */
  errors: string[];
  /** Duration in ms */
  duration_ms: number;
}

/**
 * Mock structured outputs for Claude prompts
 * @public
 */
export interface MockOutputs {
  triage?: Record<string, unknown>;
  iterate?: Record<string, unknown>;
  review?: Record<string, unknown>;
  comment?: Record<string, unknown>;
  "review-response"?: Record<string, unknown>;
  [key: string]: Record<string, unknown> | undefined;
}

/**
 * State snapshot describing GitHub state at a point in time
 * @public
 */
export interface StateSnapshot {
  name: string;
  description: string;
  issue?: {
    state?: "open" | "closed";
    labels?: string[];
    assignees?: string[];
    body_contains?: string[];
  };
  sub_issues?: {
    count?: number;
    statuses?: string[];
    iterations?: number[];
    failures?: number[];
    all_closed?: boolean;
  };
  branch?: {
    exists?: boolean;
    pattern?: string;
  };
  pull_request?: {
    exists?: boolean;
    draft?: boolean;
    merged?: boolean;
    approved?: boolean;
    review_requested?: boolean;
    links_to_issue?: boolean;
  };
  project_fields?: {
    Status?: string;
    Priority?: string;
    Size?: string;
    Iteration?: number;
    Failures?: number;
  };
}

/**
 * Test fixture from claude-test-helper
 */
export interface TestFixture {
  name: string;
  description: string;
  timeout?: number;
  poll_interval?: number;
  /** E2E test mode outcomes configuration */
  e2e_outcomes?: {
    ci: string[];
    release: string[];
    review: string[];
  };
  /** Mock structured outputs for Claude prompts */
  mock_outputs?: MockOutputs;
  /** State snapshots for snapshot-based testing */
  states?: StateSnapshot[];
  parent_issue?: {
    title: string;
    body: string;
    labels?: string[];
    project_fields?: {
      Status?: string;
      Iteration?: number;
      Failures?: number;
    };
  };
  sub_issues?: Array<{
    title: string;
    body: string;
    project_fields?: {
      Status?: string;
    };
  }>;
  branch?: {
    name: string;
    from: string;
    commits?: Array<{
      message: string;
      files: Record<string, string>;
    }>;
  };
  pr?: {
    title: string;
    body: string;
    draft?: boolean;
    request_review?: boolean;
  };
  comment?: {
    body: string;
  };
  review?: {
    state: "approve" | "request_changes" | "comment";
    body: string;
  };
  discussion?: {
    title: string;
    body: string;
    category?: string;
  };
  expected?: {
    /** Triage expectations (verified before development starts) */
    triage?: TriageExpectation;
    /** Per-phase expectations (verified during development) */
    phases?: PhaseExpectation[];
    /** Final completion expectations */
    completion?: CompletionExpectation;
    /** Legacy fields for backwards compatibility */
    parent_status?: string;
    sub_issue_statuses?: string[];
    issue_state?: string;
    pr_state?: string;
    labels?: string[];
    min_iteration?: number;
    failures?: number;
    min_comments?: number;
    all_sub_issues_closed?: boolean;
    sub_issues_todos_done?: boolean;
    history_contains?: string[];
    sub_issues_have_merged_pr?: boolean;
  };
}

/**
 * Runner configuration
 */
export interface RunnerConfig {
  /** Test fixture */
  fixture: TestFixture;
  /** Issue number to test */
  issueNumber: number;
  /** GitHub project number */
  projectNumber: number;
  /** Octokit instance */
  octokit: ReturnType<typeof import("@actions/github").getOctokit>;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Bot username (default: nopo-bot) */
  botUsername?: string;
  /** Max retries (default: 5) */
  maxRetries?: number;
}
