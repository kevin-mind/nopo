/**
 * Action Utilities
 *
 * Shared utilities for GitHub Actions entry points.
 * These wrap @actions/core and @actions/exec for convenience.
 */

import * as core from "@actions/core";
import * as exec from "@actions/exec";

// ============================================================================
// Input Utilities
// ============================================================================

/**
 * Get an input value, returning undefined if empty
 */
export function getOptionalInput(name: string): string | undefined {
  const value = core.getInput(name);
  return value === "" ? undefined : value;
}

/**
 * Get a required input value
 */
export function getRequiredInput(name: string): string {
  return core.getInput(name, { required: true });
}

// ============================================================================
// Output Utilities
// ============================================================================

/**
 * Set multiple outputs from an object
 */
export function setOutputs(outputs: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(outputs)) {
    if (value !== undefined) {
      core.setOutput(key, value);
    }
  }
}

// ============================================================================
// Exec Utilities
// ============================================================================

/**
 * Execute a command and return the output
 */
export async function execCommand(
  command: string,
  args: string[] = [],
  options?: exec.ExecOptions,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let stdout = "";
  let stderr = "";

  const exitCode = await exec.exec(command, args, {
    ...options,
    listeners: {
      stdout: (data) => {
        stdout += data.toString();
      },
      stderr: (data) => {
        stderr += data.toString();
      },
    },
  });

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

// ============================================================================
// Env Utilities
// ============================================================================

/**
 * Parse a .env file content into a key-value object
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex);
    let value = trimmed.slice(eqIndex + 1);

    // Remove surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

// ============================================================================
// Outcome Determination
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
  /** Stop reason from runner (e.g., "branch_rebased_and_pushed") */
  stopReason?: string;
  /** Whether a PR already existed before this run */
  hadExistingPR?: boolean;
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

/** Transitions that should link to PRs instead of commits */
const PR_LINK_TRANSITIONS = [
  "In Review",
  "PR Review",
  "PR Response",
  "PR Human Response",
];

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
    stopReason,
    hadExistingPR,
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
  let transition = transitionName || "unknown";

  // For "Done" transitions with a sub-issue, make the message more descriptive
  if (transitionName === "Done" && subIssueNumber && phase !== "-" && repoUrl) {
    transition = `[Phase ${phase}] Done [#${subIssueNumber}](${repoUrl}/issues/${subIssueNumber})`;
  }

  // Enrich iterate-family transitions with descriptive outcomes
  if (
    status === "Done" &&
    (transitionName === "Iterate" || transitionName === "Fix CI")
  ) {
    const phaseLink =
      phase !== "-" && subIssueNumber && repoUrl
        ? ` - [Phase ${phase}](${repoUrl}/issues/${subIssueNumber})`
        : "";

    if (stopReason === "branch_rebased_and_pushed") {
      emoji = "🔄";
      transition = `Rebased${phaseLink}`;
    } else if (transitionName === "Fix CI") {
      emoji = "🔧";
      transition = `Fixed CI${phaseLink}`;
    } else {
      transition = hadExistingPR
        ? `Updated PR${phaseLink}`
        : `Opened PR${phaseLink}`;
    }
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
