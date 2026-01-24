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
 * Test fixture from claude-test-helper
 */
export interface TestFixture {
  name: string;
  description: string;
  timeout?: number;
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
