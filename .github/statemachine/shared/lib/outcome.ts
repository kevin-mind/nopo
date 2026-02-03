/**
 * Outcome Determination Utilities
 *
 * Shared logic for determining workflow run outcomes based on job results.
 * Used by log-run-end action to format history entries.
 */

// ============================================================================
// Types
// ============================================================================

export type JobResult = "success" | "failure" | "cancelled" | "skipped";

export interface OutcomeParams {
  /** Result of the derive-actions job */
  deriveResult: JobResult;
  /** Result of the exec-state-actions job */
  execResult: JobResult;
  /** Number of actions derived */
  actionCount: number;
  /** Human-readable transition name (e.g., "Iterate", "Triage") */
  transitionName: string;
  /** Current phase number (or "-" for non-phased work) */
  phase?: string;
  /** Sub-issue number if this is a phased issue */
  subIssueNumber?: number;
  /** PR number if this is a review-related transition */
  prNumber?: number;
  /** Commit SHA for the current work */
  commitSha?: string;
  /** Repository URL for link formatting */
  repoUrl?: string;
}

export interface OutcomeResult {
  /** Status emoji (✅, ❌, ⚠️) */
  emoji: string;
  /** Status text (Done, Failed, Cancelled) */
  status: "Done" | "Failed" | "Cancelled";
  /** Formatted transition message */
  transition: string;
  /** PR number to use in history entry (null if not applicable) */
  prNumber: number | null;
  /** Commit SHA to use in history entry (null if not applicable) */
  commitSha: string | null;
}

// ============================================================================
// Constants
// ============================================================================

/** Transitions that should link to PRs instead of commits */
const PR_LINK_TRANSITIONS = [
  "In Review",
  "PR Review",
  "PR Response",
  "PR Human Response",
];

// ============================================================================
// Main Function
// ============================================================================

/**
 * Determine the outcome of a workflow run based on job results.
 *
 * This consolidates the logic that was previously inline bash in the workflow
 * into a testable, reusable function.
 *
 * @param params - Input parameters from workflow job results
 * @returns Outcome result for history entry formatting
 */
export function determineOutcome(params: OutcomeParams): OutcomeResult {
  const {
    deriveResult,
    execResult,
    actionCount,
    transitionName,
    phase = "-",
    subIssueNumber,
    prNumber,
    commitSha,
    repoUrl,
  } = params;

  // Determine emoji and status
  let emoji: string;
  let status: OutcomeResult["status"];

  if (deriveResult === "cancelled" || execResult === "cancelled") {
    emoji = "⚠️";
    status = "Cancelled";
  } else if (
    deriveResult === "success" &&
    (execResult === "success" || execResult === "skipped" || actionCount === 0)
  ) {
    emoji = "✅";
    status = "Done";
  } else {
    emoji = "❌";
    status = "Failed";
  }

  // Format transition message
  // For "Done" transitions with a sub-issue, make the message more descriptive
  let transition = transitionName || "unknown";
  if (
    transitionName === "Done" &&
    subIssueNumber &&
    phase !== "-" &&
    repoUrl
  ) {
    transition = `[Phase ${phase}] Done [#${subIssueNumber}](${repoUrl}/issues/${subIssueNumber})`;
  }

  // Determine link type - PR for review transitions, commit SHA otherwise
  let resultPrNumber: number | null = null;
  let resultCommitSha: string | null = null;

  if (PR_LINK_TRANSITIONS.includes(transition)) {
    // For review-related transitions, use PR number
    if (prNumber && prNumber > 0) {
      resultPrNumber = prNumber;
    }
  } else {
    // For iterate/other transitions, use commit SHA
    resultCommitSha = commitSha || null;
  }

  return {
    emoji,
    status,
    transition,
    prNumber: resultPrNumber,
    commitSha: resultCommitSha,
  };
}
