import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
} from "../lib/index.js";

/**
 * State stored in issue body as HTML comment
 */
interface IterationState {
  iteration: number;
  branch: string;
  pr_number: string;
  last_ci_run: string;
  last_ci_result: "success" | "failure" | "pending" | "";
  consecutive_failures: number;
  failure_type: "ci" | "workflow" | "";
  last_failure_timestamp: string;
  complete: boolean;
}

const STATE_MARKER_START = "<!-- CLAUDE_ITERATION";
const STATE_MARKER_END = "-->";
const HISTORY_SECTION = "## Iteration History";

/**
 * Parse state from issue body
 */
function parseState(body: string): IterationState | null {
  const startIdx = body.indexOf(STATE_MARKER_START);
  if (startIdx === -1) {
    return null;
  }

  const endIdx = body.indexOf(STATE_MARKER_END, startIdx);
  if (endIdx === -1) {
    return null;
  }

  const stateBlock = body.slice(startIdx + STATE_MARKER_START.length, endIdx);
  const state: IterationState = {
    iteration: 0,
    branch: "",
    pr_number: "",
    last_ci_run: "",
    last_ci_result: "",
    consecutive_failures: 0,
    failure_type: "",
    last_failure_timestamp: "",
    complete: false,
  };

  for (const line of stateBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    switch (key) {
      case "iteration":
        state.iteration = parseInt(value, 10) || 0;
        break;
      case "branch":
        state.branch = value;
        break;
      case "pr_number":
        state.pr_number = value;
        break;
      case "last_ci_run":
        state.last_ci_run = value;
        break;
      case "last_ci_result":
        state.last_ci_result = value as IterationState["last_ci_result"];
        break;
      case "consecutive_failures":
        state.consecutive_failures = parseInt(value, 10) || 0;
        break;
      case "failure_type":
        state.failure_type = value as IterationState["failure_type"];
        break;
      case "last_failure_timestamp":
        state.last_failure_timestamp = value;
        break;
      case "complete":
        state.complete = value === "true";
        break;
    }
  }

  return state;
}

/**
 * Serialize state to HTML comment block
 */
function serializeState(state: IterationState): string {
  return `${STATE_MARKER_START}
iteration: ${state.iteration}
branch: ${state.branch}
pr_number: ${state.pr_number}
last_ci_run: ${state.last_ci_run}
last_ci_result: ${state.last_ci_result}
consecutive_failures: ${state.consecutive_failures}
failure_type: ${state.failure_type}
last_failure_timestamp: ${state.last_failure_timestamp}
complete: ${state.complete}
${STATE_MARKER_END}`;
}

/**
 * Update or insert state in issue body
 */
function updateBodyWithState(body: string, state: IterationState): string {
  const stateBlock = serializeState(state);

  const startIdx = body.indexOf(STATE_MARKER_START);
  if (startIdx === -1) {
    // No existing state - prepend it
    return stateBlock + "\n\n" + body;
  }

  const endIdx = body.indexOf(STATE_MARKER_END, startIdx);
  if (endIdx === -1) {
    // Malformed - prepend new state
    return stateBlock + "\n\n" + body;
  }

  // Replace existing state
  return (
    body.slice(0, startIdx) +
    stateBlock +
    body.slice(endIdx + STATE_MARKER_END.length)
  );
}

/**
 * Add entry to iteration history table
 */
function addIterationLogEntry(
  body: string,
  iteration: number,
  message: string,
  sha?: string,
): string {
  const historyIdx = body.indexOf(HISTORY_SECTION);

  if (historyIdx === -1) {
    // Add history section before the end
    const entry = `| ${iteration} | ${message} | ${sha || "-"} |`;
    const historyTable = `

${HISTORY_SECTION}

| # | Action | SHA |
|---|--------|-----|
${entry}`;

    return body + historyTable;
  }

  // Find the table and add a row
  // Look for the last table row (starts with |)
  const lines = body.split("\n");
  const historyLineIdx = lines.findIndex((l) => l.includes(HISTORY_SECTION));

  if (historyLineIdx === -1) {
    return body;
  }

  // Find last table row after history section
  let insertIdx = historyLineIdx + 1;
  for (let i = historyLineIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("|")) {
      insertIdx = i + 1;
    } else if (lines[i].trim() !== "" && !lines[i].startsWith("|")) {
      break;
    }
  }

  const entry = `| ${iteration} | ${message} | ${sha || "-"} |`;
  lines.splice(insertIdx, 0, entry);

  return lines.join("\n");
}

/**
 * Get default state for initialization
 */
function getDefaultState(branchName: string): IterationState {
  return {
    iteration: 0,
    branch: branchName,
    pr_number: "",
    last_ci_run: "",
    last_ci_result: "",
    consecutive_failures: 0,
    failure_type: "",
    last_failure_timestamp: "",
    complete: false,
  };
}

async function run(): Promise<void> {
  try {
    const token = getRequiredInput("github_token");
    const issueNumber = parseInt(getRequiredInput("issue_number"), 10);
    const action = getRequiredInput("action");

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // Fetch current issue body
    const { data: issue } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    const currentBody = issue.body ?? "";
    let state = parseState(currentBody);
    const hasState = state !== null;

    core.info(`Action: ${action}, Has existing state: ${hasState}`);

    if (action === "read") {
      // Just read and return current state
      if (!state) {
        setOutputs({
          has_state: "false",
          iteration: "0",
          branch: "",
          pr_number: "",
          last_ci_run: "",
          last_ci_result: "",
          consecutive_failures: "0",
          failure_type: "",
          last_failure_timestamp: "",
          complete: "false",
        });
        return;
      }

      setOutputs({
        has_state: "true",
        iteration: String(state.iteration),
        branch: state.branch,
        pr_number: state.pr_number,
        last_ci_run: state.last_ci_run,
        last_ci_result: state.last_ci_result,
        consecutive_failures: String(state.consecutive_failures),
        failure_type: state.failure_type,
        last_failure_timestamp: state.last_failure_timestamp,
        complete: state.complete ? "true" : "false",
      });
      return;
    }

    if (action === "init") {
      const branchName = getRequiredInput("branch_name");

      if (state) {
        core.info("State already exists, returning existing state");
        setOutputs({
          has_state: "true",
          iteration: String(state.iteration),
          branch: state.branch,
          pr_number: state.pr_number,
          last_ci_run: state.last_ci_run,
          last_ci_result: state.last_ci_result,
          consecutive_failures: String(state.consecutive_failures),
          failure_type: state.failure_type,
          last_failure_timestamp: state.last_failure_timestamp,
          complete: state.complete ? "true" : "false",
        });
        return;
      }

      // Initialize new state
      state = getDefaultState(branchName);
      const newBody = updateBodyWithState(currentBody, state);

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(
        `Initialized state for issue #${issueNumber} with branch ${branchName}`,
      );

      setOutputs({
        has_state: "true",
        iteration: "0",
        branch: branchName,
        pr_number: "",
        last_ci_run: "",
        last_ci_result: "",
        consecutive_failures: "0",
        failure_type: "",
        last_failure_timestamp: "",
        complete: "false",
      });
      return;
    }

    if (action === "update") {
      if (!state) {
        core.setFailed("Cannot update state: no existing state found");
        return;
      }

      // Update fields if provided
      const prNumber = getOptionalInput("pr_number");
      const lastCiRun = getOptionalInput("last_ci_run");
      const lastCiResult = getOptionalInput("last_ci_result") as
        | IterationState["last_ci_result"]
        | undefined;
      const iterationMessage = getOptionalInput("iteration_message");

      if (prNumber) {
        state.pr_number = prNumber;
      }

      if (lastCiRun) {
        state.last_ci_run = lastCiRun;
      }

      if (lastCiResult) {
        // Update consecutive failures count
        if (lastCiResult === "failure") {
          state.consecutive_failures++;
          state.failure_type = "ci";
          state.last_failure_timestamp = new Date().toISOString();
        } else if (lastCiResult === "success") {
          state.consecutive_failures = 0;
          state.failure_type = "";
          state.last_failure_timestamp = "";
        }
        state.last_ci_result = lastCiResult;
      }

      let newBody = updateBodyWithState(currentBody, state);

      // Add iteration log entry if message provided
      if (iterationMessage) {
        newBody = addIterationLogEntry(
          newBody,
          state.iteration,
          iterationMessage,
        );
      }

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(`Updated state for issue #${issueNumber}`);

      setOutputs({
        has_state: "true",
        iteration: String(state.iteration),
        branch: state.branch,
        pr_number: state.pr_number,
        last_ci_run: state.last_ci_run,
        last_ci_result: state.last_ci_result,
        consecutive_failures: String(state.consecutive_failures),
        failure_type: state.failure_type,
        last_failure_timestamp: state.last_failure_timestamp,
        complete: state.complete ? "true" : "false",
      });
      return;
    }

    if (action === "increment") {
      if (!state) {
        core.setFailed("Cannot increment: no existing state found");
        return;
      }

      state.iteration++;
      const newBody = updateBodyWithState(currentBody, state);

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(
        `Incremented iteration to ${state.iteration} for issue #${issueNumber}`,
      );

      setOutputs({
        has_state: "true",
        iteration: String(state.iteration),
        branch: state.branch,
        pr_number: state.pr_number,
        last_ci_run: state.last_ci_run,
        last_ci_result: state.last_ci_result,
        consecutive_failures: String(state.consecutive_failures),
        failure_type: state.failure_type,
        last_failure_timestamp: state.last_failure_timestamp,
        complete: state.complete ? "true" : "false",
      });
      return;
    }

    if (action === "record_failure") {
      if (!state) {
        core.setFailed("Cannot record failure: no existing state found");
        return;
      }

      const failureType = getRequiredInput("failure_type") as "ci" | "workflow";
      const iterationMessage = getOptionalInput("iteration_message");

      state.consecutive_failures++;
      state.failure_type = failureType;
      state.last_failure_timestamp = new Date().toISOString();

      let newBody = updateBodyWithState(currentBody, state);

      // Add iteration log entry if message provided
      if (iterationMessage) {
        newBody = addIterationLogEntry(
          newBody,
          state.iteration,
          `❌ ${failureType} failure: ${iterationMessage}`,
        );
      }

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(
        `Recorded ${failureType} failure #${state.consecutive_failures} for issue #${issueNumber}`,
      );

      setOutputs({
        has_state: "true",
        iteration: String(state.iteration),
        branch: state.branch,
        pr_number: state.pr_number,
        last_ci_run: state.last_ci_run,
        last_ci_result: state.last_ci_result,
        consecutive_failures: String(state.consecutive_failures),
        failure_type: state.failure_type,
        last_failure_timestamp: state.last_failure_timestamp,
        complete: state.complete ? "true" : "false",
      });
      return;
    }

    if (action === "clear_failure") {
      if (!state) {
        core.setFailed("Cannot clear failure: no existing state found");
        return;
      }

      state.consecutive_failures = 0;
      state.failure_type = "";
      state.last_failure_timestamp = "";

      const newBody = updateBodyWithState(currentBody, state);

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(`Cleared failure state for issue #${issueNumber}`);

      setOutputs({
        has_state: "true",
        iteration: String(state.iteration),
        branch: state.branch,
        pr_number: state.pr_number,
        last_ci_run: state.last_ci_run,
        last_ci_result: state.last_ci_result,
        consecutive_failures: "0",
        failure_type: "",
        last_failure_timestamp: "",
        complete: state.complete ? "true" : "false",
      });
      return;
    }

    if (action === "complete") {
      if (!state) {
        core.setFailed("Cannot mark complete: no existing state found");
        return;
      }

      state.complete = true;
      state.consecutive_failures = 0;
      state.failure_type = "";
      state.last_failure_timestamp = "";
      const newBody = updateBodyWithState(currentBody, state);

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(`Marked issue #${issueNumber} as complete`);

      setOutputs({
        has_state: "true",
        iteration: String(state.iteration),
        branch: state.branch,
        pr_number: state.pr_number,
        last_ci_run: state.last_ci_run,
        last_ci_result: state.last_ci_result,
        consecutive_failures: "0",
        failure_type: "",
        last_failure_timestamp: "",
        complete: "true",
      });
      return;
    }

    core.setFailed(`Unknown action: ${action}`);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

run();
