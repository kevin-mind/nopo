import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
} from "../lib/index.js";

/**
 * State stored in sub-issue body as HTML comment (CLAUDE_ITERATION)
 * Used for tracking iteration progress on individual sub-issues (phases)
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
  // Phase-specific iteration tracking
  phase_iteration: number; // Iterations within current phase (resets on phase change)
  last_phase: number; // Last known phase number (for detecting phase changes)
  // Sub-issue context (links back to parent)
  parent_issue: number; // Parent issue number (0 if not a sub-issue)
  phase_number: number; // Phase number within parent (0 if not a sub-issue)
}

/**
 * State stored in main issue body as HTML comment (CLAUDE_MAIN_STATE)
 * Used for orchestrating work across multiple sub-issues
 */
interface MainIssueState {
  orchestration_iteration: number; // How many times we've run orchestration
  sub_issues: number[]; // Array of sub-issue numbers
  current_sub_issue: number; // Currently active sub-issue
  sub_issue_status: Record<number, "pending" | "in_progress" | "merged">; // Status of each sub-issue
  complete: boolean; // Whether all sub-issues are merged
}

/**
 * Phase information extracted from issue body
 */
interface PhaseInfo {
  current_phase: number;
  total_phases: number;
  current_phase_todos_done: boolean;
  all_phases_done: boolean;
  current_phase_title: string;
}

const STATE_MARKER_START = "<!-- CLAUDE_ITERATION";
const MAIN_STATE_MARKER_START = "<!-- CLAUDE_MAIN_STATE";
const STATE_MARKER_END = "-->";
const HISTORY_SECTION = "## Iteration History";
const PHASES_SECTION = "## Phases";

/**
 * Count unchecked todos that are NOT manual tasks.
 * Manual tasks are marked with *(manual)* and should not block phase completion.
 */
function countNonManualUncheckedTodos(content: string): number {
  const lines = content.split("\n");
  let count = 0;
  for (const line of lines) {
    // Check if line has an unchecked todo
    if (line.match(/- \[ \]/)) {
      // Skip if it's marked as manual
      if (!line.includes("*(manual)*")) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Parse phases from issue body
 * Phases are defined as "## Phase N: Title" sections with checkbox todos
 */
function parsePhases(body: string): PhaseInfo {
  // Match "## Phase N: Title" headers
  const phaseRegex = /^## Phase (\d+):\s*(.+)$/gm;
  const phases: Array<{
    number: number;
    title: string;
    startIndex: number;
  }> = [];

  let match;
  while ((match = phaseRegex.exec(body)) !== null) {
    phases.push({
      number: parseInt(match[1], 10),
      title: match[2].trim(),
      startIndex: match.index,
    });
  }

  // If no phases found, treat the entire issue as a single phase
  if (phases.length === 0) {
    // Check for any unchecked todos in the whole body (excluding manual tasks)
    const uncheckedTodos = countNonManualUncheckedTodos(body);
    return {
      current_phase: 1,
      total_phases: 1,
      current_phase_todos_done: uncheckedTodos === 0,
      all_phases_done: uncheckedTodos === 0,
      current_phase_title: "Todo",
    };
  }

  // Sort phases by number
  phases.sort((a, b) => a.number - b.number);

  // For each phase, extract todos and check completion
  const phaseCompletion: Array<{
    number: number;
    title: string;
    uncheckedCount: number;
    checkedCount: number;
  }> = [];

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const nextPhase = phases[i + 1];

    // Extract content between this phase header and the next (or end of body)
    const endIndex = nextPhase ? nextPhase.startIndex : body.length;
    const phaseContent = body.slice(phase.startIndex, endIndex);

    // Count checked and unchecked todos in this phase (excluding manual tasks from unchecked)
    const uncheckedCount = countNonManualUncheckedTodos(phaseContent);
    const checkedCount = (phaseContent.match(/- \[x\]/gi) || []).length;

    phaseCompletion.push({
      number: phase.number,
      title: phase.title,
      uncheckedCount,
      checkedCount,
    });
  }

  // Find current phase (first phase with unchecked todos)
  const currentPhaseData = phaseCompletion.find((p) => p.uncheckedCount > 0);
  const currentPhase =
    currentPhaseData?.number || phases[phases.length - 1].number;
  const currentPhaseTitle =
    currentPhaseData?.title || phases[phases.length - 1].title;

  // Check if current phase is done
  const currentPhaseInfo = phaseCompletion.find(
    (p) => p.number === currentPhase,
  );
  const currentPhaseTodosDone = currentPhaseInfo
    ? currentPhaseInfo.uncheckedCount === 0
    : true;

  // Check if all phases are done
  const allPhasesDone = phaseCompletion.every((p) => p.uncheckedCount === 0);

  return {
    current_phase: currentPhase,
    total_phases: phases.length,
    current_phase_todos_done: currentPhaseTodosDone,
    all_phases_done: allPhasesDone,
    current_phase_title: currentPhaseTitle,
  };
}

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
    phase_iteration: 0,
    last_phase: 0,
    parent_issue: 0,
    phase_number: 0,
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
      case "phase_iteration":
        state.phase_iteration = parseInt(value, 10) || 0;
        break;
      case "last_phase":
        state.last_phase = parseInt(value, 10) || 0;
        break;
      case "parent_issue":
        state.parent_issue = parseInt(value, 10) || 0;
        break;
      case "phase_number":
        state.phase_number = parseInt(value, 10) || 0;
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
phase_iteration: ${state.phase_iteration}
last_phase: ${state.last_phase}
parent_issue: ${state.parent_issue}
phase_number: ${state.phase_number}
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
 * Update an existing entry in iteration history table by run link
 * Returns the updated body, or the original body if not found
 */
function updateIterationLogEntry(
  body: string,
  runLink: string,
  newMessage: string,
  sha?: string,
): string {
  const historyIdx = body.indexOf(HISTORY_SECTION);
  if (historyIdx === -1) {
    return body; // No history section, return unchanged
  }

  const lines = body.split("\n");
  const historyLineIdx = lines.findIndex((l) => l.includes(HISTORY_SECTION));
  if (historyLineIdx === -1) {
    return body;
  }

  // Find the row containing this run link
  let foundIdx = -1;
  for (let i = historyLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("|") && line.includes(runLink)) {
      foundIdx = i;
      break;
    } else if (line.trim() !== "" && !line.startsWith("|")) {
      break; // End of table
    }
  }

  if (foundIdx === -1) {
    return body; // Row not found, return unchanged
  }

  // Parse the existing row to extract iteration number
  const existingRow = lines[foundIdx];
  const match = existingRow.match(/^\|\s*(\d+)\s*\|/);
  if (!match) {
    return body; // Can't parse row, return unchanged
  }

  const iteration = parseInt(match[1], 10);

  // Format SHA as a full GitHub link if provided
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY || "";
  const shaCell = sha
    ? `[\`${sha.slice(0, 7)}\`](${serverUrl}/${repo}/commit/${sha})`
    : "-";
  const runCell = `[Run](${runLink})`;

  // Build the new row
  const newRow = `| ${iteration} | ${newMessage} | ${shaCell} | ${runCell} |`;
  lines[foundIdx] = newRow;

  return lines.join("\n");
}

/**
 * Add entry to iteration history table
 */
function addIterationLogEntry(
  body: string,
  iteration: number,
  message: string,
  sha?: string,
  runLink?: string,
): string {
  const historyIdx = body.indexOf(HISTORY_SECTION);

  // Format SHA as a full GitHub link if provided
  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repo = process.env.GITHUB_REPOSITORY || "";
  const shaCell = sha
    ? `[\`${sha.slice(0, 7)}\`](${serverUrl}/${repo}/commit/${sha})`
    : "-";
  // Format run link if provided
  const runCell = runLink ? `[Run](${runLink})` : "-";

  if (historyIdx === -1) {
    // Add history section before the end
    const entry = `| ${iteration} | ${message} | ${shaCell} | ${runCell} |`;
    const historyTable = `

${HISTORY_SECTION}

| # | Action | SHA | Run |
|---|--------|-----|-----|
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

  const entry = `| ${iteration} | ${message} | ${shaCell} | ${runCell} |`;
  lines.splice(insertIdx, 0, entry);

  return lines.join("\n");
}

/**
 * Get default state for initialization
 */
function getDefaultState(
  branchName: string,
  parentIssue = 0,
  phaseNumber = 0,
): IterationState {
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
    phase_iteration: 0,
    last_phase: 0,
    parent_issue: parentIssue,
    phase_number: phaseNumber,
  };
}

/**
 * Get default main state for orchestration
 */
function getDefaultMainState(): MainIssueState {
  return {
    orchestration_iteration: 0,
    sub_issues: [],
    current_sub_issue: 0,
    sub_issue_status: {},
    complete: false,
  };
}

/**
 * Parse main issue state from issue body
 */
function parseMainState(body: string): MainIssueState | null {
  const startIdx = body.indexOf(MAIN_STATE_MARKER_START);
  if (startIdx === -1) {
    return null;
  }

  const endIdx = body.indexOf(STATE_MARKER_END, startIdx);
  if (endIdx === -1) {
    return null;
  }

  const stateBlock = body.slice(
    startIdx + MAIN_STATE_MARKER_START.length,
    endIdx,
  );
  const state: MainIssueState = getDefaultMainState();

  for (const line of stateBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    switch (key) {
      case "orchestration_iteration":
        state.orchestration_iteration = parseInt(value, 10) || 0;
        break;
      case "sub_issues":
        // Parse comma-separated list of issue numbers
        state.sub_issues = value
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n) && n > 0);
        break;
      case "current_sub_issue":
        state.current_sub_issue = parseInt(value, 10) || 0;
        break;
      case "sub_issue_status":
        // Parse as JSON object
        try {
          state.sub_issue_status = JSON.parse(value);
        } catch {
          state.sub_issue_status = {};
        }
        break;
      case "complete":
        state.complete = value === "true";
        break;
    }
  }

  return state;
}

/**
 * Serialize main state to HTML comment block
 */
function serializeMainState(state: MainIssueState): string {
  return `${MAIN_STATE_MARKER_START}
orchestration_iteration: ${state.orchestration_iteration}
sub_issues: ${state.sub_issues.join(", ")}
current_sub_issue: ${state.current_sub_issue}
sub_issue_status: ${JSON.stringify(state.sub_issue_status)}
complete: ${state.complete}
${STATE_MARKER_END}`;
}

/**
 * Update or insert main state in issue body
 */
function updateBodyWithMainState(body: string, state: MainIssueState): string {
  const stateBlock = serializeMainState(state);

  const startIdx = body.indexOf(MAIN_STATE_MARKER_START);
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
 * Update or insert phases table in issue body
 */
function updatePhasesTable(
  body: string,
  subIssues: Array<{ number: number; title: string; status: string }>,
): string {
  const phasesIdx = body.indexOf(PHASES_SECTION);

  // Build the phases table
  const tableHeader = `| # | Sub-Issue | Status |
|---|-----------|--------|`;
  const tableRows = subIssues
    .map((si, idx) => {
      const statusEmoji =
        si.status === "merged"
          ? "✅"
          : si.status === "in_progress"
            ? "🔄"
            : "⏸️";
      return `| ${idx + 1} | #${si.number} - ${si.title} | ${statusEmoji} ${si.status} |`;
    })
    .join("\n");

  const newTable = `${PHASES_SECTION}

${tableHeader}
${tableRows}`;

  if (phasesIdx === -1) {
    // No existing phases section - append it
    return body + "\n\n" + newTable;
  }

  // Find the end of the phases section (next ## header or end of body)
  const afterPhases = body.slice(phasesIdx + PHASES_SECTION.length);
  const nextSectionMatch = afterPhases.match(/\n## /);
  const endIdx = nextSectionMatch
    ? phasesIdx + PHASES_SECTION.length + nextSectionMatch.index!
    : body.length;

  // Replace existing phases section
  return body.slice(0, phasesIdx) + newTable + body.slice(endIdx);
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
          phase_iteration: "0",
          last_phase: "0",
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
        phase_iteration: String(state.phase_iteration),
        last_phase: String(state.last_phase),
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
        phase_iteration: "0",
        last_phase: "0",
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
      const commitSha = getOptionalInput("commit_sha");
      const runLink = getOptionalInput("run_link");

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
        // Add emoji based on CI result
        let formattedMessage = iterationMessage;
        if (lastCiResult === "failure") {
          formattedMessage = `❌ ${iterationMessage}`;
        } else if (lastCiResult === "success") {
          formattedMessage = `✅ ${iterationMessage}`;
        } else if (lastCiResult === "cancelled") {
          formattedMessage = `⚠️ ${iterationMessage}`;
        }

        newBody = addIterationLogEntry(
          newBody,
          state.iteration,
          formattedMessage,
          commitSha,
          runLink,
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
        phase_iteration: String(state.phase_iteration),
        last_phase: String(state.last_phase),
      });
      return;
    }

    if (action === "increment") {
      if (!state) {
        core.setFailed("Cannot increment: no existing state found");
        return;
      }

      // Get current phase from input (optional - for phase change detection)
      const currentPhaseInput = getOptionalInput("current_phase");
      const currentPhase = currentPhaseInput
        ? parseInt(currentPhaseInput, 10)
        : 0;

      // Check for phase change and reset phase_iteration if needed
      let phaseChanged = false;
      if (currentPhase > 0 && currentPhase !== state.last_phase) {
        core.info(
          `Phase changed from ${state.last_phase} to ${currentPhase}, resetting phase_iteration`,
        );
        state.phase_iteration = 0;
        state.last_phase = currentPhase;
        phaseChanged = true;
      }

      // Increment both total iteration and phase iteration
      state.iteration++;
      state.phase_iteration++;

      const newBody = updateBodyWithState(currentBody, state);

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(
        `Incremented iteration to ${state.iteration} (phase ${state.last_phase}: ${state.phase_iteration}) for issue #${issueNumber}` +
          (phaseChanged ? " [phase changed]" : ""),
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
        phase_iteration: String(state.phase_iteration),
        last_phase: String(state.last_phase),
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
      const commitSha = getOptionalInput("commit_sha");
      const runLink = getOptionalInput("run_link");

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
          commitSha,
          runLink,
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
        phase_iteration: String(state.phase_iteration),
        last_phase: String(state.last_phase),
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
        phase_iteration: String(state.phase_iteration),
        last_phase: String(state.last_phase),
      });
      return;
    }

    if (action === "complete") {
      if (!state) {
        core.setFailed("Cannot mark complete: no existing state found");
        return;
      }

      const runLink = getOptionalInput("run_link");

      state.complete = true;
      state.consecutive_failures = 0;
      state.failure_type = "";
      state.last_failure_timestamp = "";
      let newBody = updateBodyWithState(currentBody, state);

      // Add completion log entry
      newBody = addIterationLogEntry(
        newBody,
        state.iteration,
        "✅ Complete",
        undefined,
        runLink,
      );

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
        phase_iteration: String(state.phase_iteration),
        last_phase: String(state.last_phase),
      });
      return;
    }

    if (action === "reset") {
      // Reset is used when human explicitly re-triggers iteration (re-assigns nopo-bot)
      // It clears failure state and marks issue as not complete, preserving iteration history
      if (!state) {
        core.setFailed("Cannot reset: no existing state found");
        return;
      }

      const iterationMessage = getOptionalInput("iteration_message");

      state.consecutive_failures = 0;
      state.failure_type = "";
      state.last_failure_timestamp = "";
      state.complete = false;
      state.last_ci_result = "";
      state.phase_iteration = 0; // Reset phase iteration count for fresh start

      let newBody = updateBodyWithState(currentBody, state);

      // Add iteration log entry if message provided
      if (iterationMessage) {
        newBody = addIterationLogEntry(
          newBody,
          state.iteration,
          `🔄 ${iterationMessage}`,
        );
      }

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(
        `Reset failure state for issue #${issueNumber} (preserving iteration ${state.iteration})`,
      );

      setOutputs({
        has_state: "true",
        iteration: String(state.iteration),
        branch: state.branch,
        pr_number: state.pr_number,
        last_ci_run: state.last_ci_run,
        last_ci_result: "",
        consecutive_failures: "0",
        failure_type: "",
        last_failure_timestamp: "",
        complete: "false",
        phase_iteration: String(state.phase_iteration),
        last_phase: String(state.last_phase),
      });
      return;
    }

    if (action === "log_event") {
      // Log an event to the iteration history without modifying other state
      // Useful for events like circuit breaker, review events, etc.
      if (!state) {
        core.setFailed("Cannot log event: no existing state found");
        return;
      }

      const iterationMessage = getRequiredInput("iteration_message");
      const commitSha = getOptionalInput("commit_sha");
      const runLink = getOptionalInput("run_link");

      // Message is used as-is (no emoji modification)
      const newBody = addIterationLogEntry(
        currentBody,
        state.iteration,
        iterationMessage,
        commitSha,
        runLink,
      );

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(`Logged event for issue #${issueNumber}: ${iterationMessage}`);

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
        phase_iteration: String(state.phase_iteration),
        last_phase: String(state.last_phase),
      });
      return;
    }

    if (action === "update_log_entry") {
      // Update an existing log entry in-place, identified by run_link
      // If not found, falls back to adding a new entry
      // Used for real-time progress: logs "Running..." at start, updates to final status on completion
      if (!state) {
        core.setFailed("Cannot update log entry: no existing state found");
        return;
      }

      const runLink = getRequiredInput("run_link");
      const iterationMessage = getRequiredInput("iteration_message");
      const commitSha = getOptionalInput("commit_sha");

      // Try to update existing entry by run_link
      let newBody = updateIterationLogEntry(
        currentBody,
        runLink,
        iterationMessage,
        commitSha,
      );

      // If not found (body unchanged), fall back to adding new entry
      if (newBody === currentBody) {
        core.info(
          `No existing entry found for run link, adding new entry instead`,
        );
        newBody = addIterationLogEntry(
          currentBody,
          state.iteration,
          iterationMessage,
          commitSha,
          runLink,
        );
      }

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(
        `Updated log entry for issue #${issueNumber}: ${iterationMessage}`,
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
        phase_iteration: String(state.phase_iteration),
        last_phase: String(state.last_phase),
      });
      return;
    }

    if (action === "parse_phases") {
      // Parse phase structure from issue body
      // Returns current phase, total phases, and completion status
      const phaseInfo = parsePhases(currentBody);

      core.info(
        `Parsed phases for issue #${issueNumber}: Phase ${phaseInfo.current_phase}/${phaseInfo.total_phases}, ` +
          `current phase done: ${phaseInfo.current_phase_todos_done}, all done: ${phaseInfo.all_phases_done}`,
      );

      setOutputs({
        current_phase: String(phaseInfo.current_phase),
        total_phases: String(phaseInfo.total_phases),
        current_phase_todos_done: phaseInfo.current_phase_todos_done
          ? "true"
          : "false",
        all_phases_done: phaseInfo.all_phases_done ? "true" : "false",
        current_phase_title: phaseInfo.current_phase_title,
      });
      return;
    }

    // Main issue state actions (for orchestrating sub-issues)
    if (action === "read_main") {
      // Read main issue state
      const mainState = parseMainState(currentBody);
      if (!mainState) {
        setOutputs({
          has_main_state: "false",
          orchestration_iteration: "0",
          sub_issues: "",
          current_sub_issue: "0",
          sub_issue_status: "{}",
          main_complete: "false",
        });
        return;
      }

      setOutputs({
        has_main_state: "true",
        orchestration_iteration: String(mainState.orchestration_iteration),
        sub_issues: mainState.sub_issues.join(","),
        current_sub_issue: String(mainState.current_sub_issue),
        sub_issue_status: JSON.stringify(mainState.sub_issue_status),
        main_complete: mainState.complete ? "true" : "false",
      });
      return;
    }

    if (action === "init_main") {
      // Initialize main issue state with sub-issues
      const subIssuesInput = getRequiredInput("sub_issues");
      const subIssues = subIssuesInput
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0);

      if (subIssues.length === 0) {
        core.setFailed("Cannot init_main: no valid sub-issues provided");
        return;
      }

      // Check if main state already exists
      let mainState = parseMainState(currentBody);
      if (mainState) {
        core.info("Main state already exists, returning existing state");
        setOutputs({
          has_main_state: "true",
          orchestration_iteration: String(mainState.orchestration_iteration),
          sub_issues: mainState.sub_issues.join(","),
          current_sub_issue: String(mainState.current_sub_issue),
          sub_issue_status: JSON.stringify(mainState.sub_issue_status),
          main_complete: mainState.complete ? "true" : "false",
        });
        return;
      }

      // Initialize new main state
      mainState = getDefaultMainState();
      mainState.sub_issues = subIssues;
      mainState.current_sub_issue = subIssues[0];
      mainState.sub_issue_status = Object.fromEntries(
        subIssues.map((num) => [num, "pending" as const]),
      );

      const newBody = updateBodyWithMainState(currentBody, mainState);

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(
        `Initialized main state for issue #${issueNumber} with ${subIssues.length} sub-issues`,
      );

      setOutputs({
        has_main_state: "true",
        orchestration_iteration: "0",
        sub_issues: subIssues.join(","),
        current_sub_issue: String(subIssues[0]),
        sub_issue_status: JSON.stringify(mainState.sub_issue_status),
        main_complete: "false",
      });
      return;
    }

    if (action === "update_main") {
      // Update main issue state
      const mainState = parseMainState(currentBody);
      if (!mainState) {
        core.setFailed("Cannot update_main: no existing main state found");
        return;
      }

      // Update fields if provided
      const currentSubIssue = getOptionalInput("current_sub_issue");
      const subIssueStatusInput = getOptionalInput("sub_issue_status");

      if (currentSubIssue) {
        mainState.current_sub_issue = parseInt(currentSubIssue, 10);
      }

      if (subIssueStatusInput) {
        try {
          mainState.sub_issue_status = JSON.parse(subIssueStatusInput);
        } catch {
          core.warning(
            "Failed to parse sub_issue_status JSON, skipping update",
          );
        }
      }

      const newBody = updateBodyWithMainState(currentBody, mainState);

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(`Updated main state for issue #${issueNumber}`);

      setOutputs({
        has_main_state: "true",
        orchestration_iteration: String(mainState.orchestration_iteration),
        sub_issues: mainState.sub_issues.join(","),
        current_sub_issue: String(mainState.current_sub_issue),
        sub_issue_status: JSON.stringify(mainState.sub_issue_status),
        main_complete: mainState.complete ? "true" : "false",
      });
      return;
    }

    if (action === "advance_phase") {
      // Advance to the next sub-issue (phase) after current one is merged
      const mainState = parseMainState(currentBody);
      if (!mainState) {
        core.setFailed("Cannot advance_phase: no existing main state found");
        return;
      }

      const completedSubIssue = getRequiredInput("completed_sub_issue");
      const completedNum = parseInt(completedSubIssue, 10);

      // Mark the completed sub-issue as merged
      mainState.sub_issue_status[completedNum] = "merged";
      mainState.orchestration_iteration++;

      // Find the next pending sub-issue
      const nextPending = mainState.sub_issues.find(
        (num) => mainState.sub_issue_status[num] === "pending",
      );

      if (nextPending) {
        mainState.current_sub_issue = nextPending;
        mainState.sub_issue_status[nextPending] = "in_progress";
        core.info(
          `Advanced from sub-issue #${completedNum} to #${nextPending}`,
        );
      } else {
        // All sub-issues are merged
        mainState.complete = true;
        core.info(`All sub-issues complete for issue #${issueNumber}`);
      }

      const newBody = updateBodyWithMainState(currentBody, mainState);

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      setOutputs({
        has_main_state: "true",
        orchestration_iteration: String(mainState.orchestration_iteration),
        sub_issues: mainState.sub_issues.join(","),
        current_sub_issue: String(mainState.current_sub_issue),
        sub_issue_status: JSON.stringify(mainState.sub_issue_status),
        main_complete: mainState.complete ? "true" : "false",
        next_sub_issue: nextPending ? String(nextPending) : "",
      });
      return;
    }

    if (action === "update_phases_table") {
      // Update the phases table in the issue body
      // Expects sub_issues_data as JSON array of {number, title, status}
      const subIssuesDataInput = getRequiredInput("sub_issues_data");
      let subIssuesData: Array<{
        number: number;
        title: string;
        status: string;
      }>;

      try {
        subIssuesData = JSON.parse(subIssuesDataInput);
      } catch {
        core.setFailed("Failed to parse sub_issues_data JSON");
        return;
      }

      const newBody = updatePhasesTable(currentBody, subIssuesData);

      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        body: newBody,
      });

      core.info(
        `Updated phases table for issue #${issueNumber} with ${subIssuesData.length} phases`,
      );

      setOutputs({
        success: "true",
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
