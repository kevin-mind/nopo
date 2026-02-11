/**
 * Unified State Machine Runner Action
 *
 * Single action that performs the complete run cycle:
 * 1. Build machine context and derive actions (state machine transition)
 * 2. Log run start (append history entry)
 * 3. Execute all derived actions sequentially
 * 4. Log run end (update history with outcome)
 * 5. Determine retrigger decision
 *
 * Replaces the previous multi-job pipeline in sm-runner.yml:
 * derive-context → log-run-start → derive-actions → exec-state-actions →
 * log-run-end → check-retrigger
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { parseIssue, type OctokitLike } from "@more/issue-state";
import {
  // Action utilities
  getRequiredInput,
  getOptionalInput,
  setOutputs,
  determineOutcome,
  type JobResult,
  // Workflow context
  parseWorkflowContext,
  isDiscussionTrigger as checkDiscussionTrigger,
  type WorkflowContext,
  type TriggerType,
  type DiscussionTriggerType,
  type Action,
  // Runner
  executeActions,
  createRunnerContext,
  logRunnerSummary,
  type RunnerResult,
  // Derive functions
  deriveIssueActions,
  deriveDiscussionActions,
  type DeriveResult,
  // MDAST mutators
  updateHistoryEntry,
  addHistoryEntry,
} from "@more/statemachine";

// ============================================================================
// Helpers
// ============================================================================

function asOctokitLike(
  octokit: ReturnType<typeof github.getOctokit>,
): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @actions/github octokit type differs from OctokitLike but is compatible
  return octokit as unknown as OctokitLike;
}

/**
 * Determine whether the workflow should retrigger.
 * Terminal states and Claude runs (waiting for CI) should NOT retrigger.
 */
function shouldRetrigger(
  finalState: string,
  actions: Action[],
  continueFlag: boolean,
): boolean {
  if (!continueFlag) return false;

  // Don't retrigger if we just ran Claude (waiting for push → CI)
  const hasClaudeRun = actions.some((a) => a.type === "runClaude");
  if (hasClaudeRun) return false;

  // Terminal/waiting states that should not retrigger
  const noRetriggerStates = new Set([
    "done",
    "blocked",
    "error",
    "alreadyDone",
    "alreadyBlocked",
    "terminal",
    "reviewing",
    "triaged",
    "orchestrationRunning",
    "orchestrationWaiting",
    "orchestrationComplete",
    "grooming",
    "subIssueIdle",
  ]);

  return !noRetriggerStates.has(finalState);
}

/**
 * Determine if a set of actions requires the issue branch (not main).
 * Actions like runClaude, gitPush, createBranch need the working branch.
 */
function actionsNeedBranch(actions: Action[]): boolean {
  const branchActionTypes = new Set([
    "runClaude",
    "runClaudeGrooming",
    "gitPush",
    "createBranch",
  ]);
  return actions.some((a) => branchActionTypes.has(a.type));
}

/**
 * Determine the branch to use for action execution.
 * Returns null if no branch switch is needed (stay on main).
 */
function getExecutionBranch(
  actions: Action[],
  ctx: WorkflowContext,
): string | null {
  if (!actionsNeedBranch(actions)) return null;

  // Check for worktree specified on actions
  for (const action of actions) {
    if ("worktree" in action && action.worktree) {
      return String(action.worktree);
    }
  }

  return ctx.branch_name || null;
}

// ============================================================================
// Phase: Log Run Start
// ============================================================================

async function logRunStart(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
  iteration: number,
  phase: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    core.info("[DRY RUN] Would log run start");
    return;
  }

  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repository = process.env.GITHUB_REPOSITORY || `${owner}/${repo}`;
  const runId = process.env.GITHUB_RUN_ID || "";
  const runLink = `${serverUrl}/${repository}/actions/runs/${runId}`;
  const repoUrl = `${serverUrl}/${owner}/${repo}`;

  try {
    const { data, update } = await parseIssue(owner, repo, issueNumber, {
      octokit: asOctokitLike(octokit),
      fetchPRs: false,
      fetchParent: false,
    });

    const state = addHistoryEntry(
      {
        iteration,
        phase,
        action: "\u23f3 running...",
        timestamp: new Date().toISOString(),
        runLink,
        repoUrl,
      },
      data,
    );

    await update(state);
    core.info(`Logged run start for issue #${issueNumber}`);
  } catch (error) {
    // Don't fail the entire run if history logging fails
    core.warning(`Failed to log run start: ${error}`);
  }
}

// ============================================================================
// Phase: Log Run End
// ============================================================================

async function logRunEnd(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  issueNumber: number,
  deriveResult: DeriveResult,
  execSuccess: boolean,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    core.info("[DRY RUN] Would log run end");
    return;
  }

  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const repository = process.env.GITHUB_REPOSITORY || `${owner}/${repo}`;
  const runId = process.env.GITHUB_RUN_ID || "";
  const runUrl = `${serverUrl}/${repository}/actions/runs/${runId}`;
  const repoUrl = `${serverUrl}/${owner}/${repo}`;

  // Determine outcome

  const execResult: JobResult = execSuccess ? "success" : "failure";
  const outcome = determineOutcome({
    deriveResult: "success",
    execResult,
    actionCount: deriveResult.pendingActions.length,
    transitionName: deriveResult.transitionName,
    phase: deriveResult.phase,
    subIssueNumber: deriveResult.subIssueNumber
      ? parseInt(deriveResult.subIssueNumber, 10)
      : undefined,
    prNumber: deriveResult.prNumber
      ? parseInt(deriveResult.prNumber, 10)
      : undefined,
    commitSha: deriveResult.commitSha || undefined,
    repoUrl,
  });

  core.info(`Outcome: ${outcome.emoji} ${outcome.status}`);

  const iteration = parseInt(deriveResult.iteration, 10);
  const newMessage = `${outcome.emoji} ${outcome.transition}`;

  try {
    const { data, update } = await parseIssue(owner, repo, issueNumber, {
      octokit: asOctokitLike(octokit),
      fetchPRs: false,
      fetchParent: false,
    });

    const parentNumber = data.issue.parentIssueNumber;

    // Update the existing "running..." entry
    let state = updateHistoryEntry(
      {
        matchIteration: iteration,
        matchPhase: deriveResult.phase,
        matchPattern: "\u23f3 running...",
        newAction: newMessage,
        timestamp: new Date().toISOString(),
        sha: outcome.commitSha || undefined,
        runLink: runUrl,
        repoUrl,
      },
      data,
    );

    if (state === data) {
      // No matching entry found - add a new entry
      core.info(
        `No matching history entry found - adding new entry for Phase ${deriveResult.phase}`,
      );
      state = addHistoryEntry(
        {
          iteration,
          phase: deriveResult.phase,
          action: newMessage,
          timestamp: new Date().toISOString(),
          sha: outcome.commitSha || undefined,
          runLink: runUrl,
          repoUrl,
        },
        state,
      );
    }

    await update(state);
    core.info(`Updated history for issue #${issueNumber}`);

    // Also update parent if this is a sub-issue
    if (parentNumber) {
      try {
        const { data: parentData, update: parentUpdate } = await parseIssue(
          owner,
          repo,
          parentNumber,
          {
            octokit: asOctokitLike(octokit),
            fetchPRs: false,
            fetchParent: false,
          },
        );

        let parentState = updateHistoryEntry(
          {
            matchIteration: iteration,
            matchPhase: deriveResult.phase,
            matchPattern: "\u23f3 running...",
            newAction: newMessage,
            timestamp: new Date().toISOString(),
            sha: outcome.commitSha || undefined,
            runLink: runUrl,
            repoUrl,
          },
          parentData,
        );

        if (parentState === parentData) {
          parentState = addHistoryEntry(
            {
              iteration,
              phase: deriveResult.phase,
              action: newMessage,
              timestamp: new Date().toISOString(),
              sha: outcome.commitSha || undefined,
              runLink: runUrl,
              repoUrl,
            },
            parentState,
          );
        }

        await parentUpdate(parentState);
        core.info(`Also updated parent issue #${parentNumber}`);
      } catch (error) {
        core.warning(
          `Failed to update parent issue #${parentNumber}: ${error}`,
        );
      }
    }
  } catch (error) {
    core.warning(`Failed to log run end: ${error}`);
  }
}

// ============================================================================
// Phase: E2E Review Simulation
// ============================================================================

/**
 * Submit a simulated review via the GitHub API for E2E testing.
 * Replicates the old workflow's "E2E Simulate Review" step.
 */
async function e2eSimulateReview(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  reviewOutcome: string,
): Promise<void> {
  type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  const outcomeMap: Record<string, { event: ReviewEvent; body: string }> = {
    approved: {
      event: "APPROVE",
      body: "E2E Test: Simulated approval review",
    },
    changes_requested: {
      event: "REQUEST_CHANGES",
      body: "E2E Test: Simulated changes requested review",
    },
    comment: {
      event: "COMMENT",
      body: "E2E Test: Simulated comment review",
    },
  };

  const mapped = outcomeMap[reviewOutcome];
  if (!mapped) {
    throw new Error(`Unknown E2E review outcome: ${reviewOutcome}`);
  }

  core.info(
    `[E2E MODE] Simulating review with outcome=${reviewOutcome} (event=${mapped.event})`,
  );

  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    event: mapped.event,
    body: mapped.body,
  });

  core.info(`[E2E MODE] Simulated review submitted: ${mapped.event}`);
}

/**
 * Pre-process actions for E2E mode.
 * - runClaude with token=review: simulate the review and remove from action list
 * - Other runClaude/runClaudeGrooming: remove (Claude CLI not installed in E2E mode)
 * Returns the filtered actions array (non-Claude actions pass through unchanged).
 */
async function e2eFilterActions(
  actions: Action[],
  reviewOctokit: ReturnType<typeof github.getOctokit> | undefined,
  codeOctokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  e2eReviewOutcome: string,
): Promise<Action[]> {
  const filtered: Action[] = [];

  for (const action of actions) {
    if (action.type === "runClaude" && action.token === "review") {
      // Simulate review submission instead of running Claude
      const prNumber = action.promptVars?.PR_NUMBER
        ? parseInt(action.promptVars.PR_NUMBER, 10)
        : 0;

      if (prNumber > 0) {
        // Use reviewOctokit if available (separate reviewer account), else codeOctokit
        const octokit = reviewOctokit ?? codeOctokit;
        await e2eSimulateReview(
          octokit,
          owner,
          repo,
          prNumber,
          e2eReviewOutcome,
        );
      } else {
        core.warning(
          "[E2E MODE] runClaude review action missing PR_NUMBER, skipping simulation",
        );
      }
      // Don't include this action — it's been handled
      continue;
    }

    if (action.type === "runClaude" || action.type === "runClaudeGrooming") {
      // Skip real Claude execution in E2E mode (CLI not installed)
      core.info(
        `[E2E MODE] Skipping ${action.type} action (Claude CLI not installed in E2E mode)`,
      );
      continue;
    }

    filtered.push(action);
  }

  return filtered;
}

// ============================================================================
// Phase: Execute Actions
// ============================================================================

async function executeAllActions(
  actions: Action[],
  codeOctokit: ReturnType<typeof github.getOctokit>,
  reviewOctokit: ReturnType<typeof github.getOctokit> | undefined,
  owner: string,
  repo: string,
  projectNumber: number,
  dryRun: boolean,
  e2eMode: boolean,
  e2eReviewOutcome: string,
): Promise<RunnerResult> {
  // In E2E mode, simulate reviews and skip Claude actions before passing to runner
  let actionsToRun = actions;
  if (e2eMode) {
    core.info("[E2E MODE] Pre-processing actions for E2E simulation");
    actionsToRun = await e2eFilterActions(
      actions,
      reviewOctokit,
      codeOctokit,
      owner,
      repo,
      e2eReviewOutcome,
    );
    core.info(
      `[E2E MODE] ${actions.length - actionsToRun.length} action(s) handled by E2E simulation, ${actionsToRun.length} remaining`,
    );
  }

  const runnerContext = createRunnerContext(
    codeOctokit,
    owner,
    repo,
    projectNumber,
    {
      dryRun,
      reviewOctokit,
    },
  );

  const result = await executeActions(actionsToRun, runnerContext);
  logRunnerSummary(result);

  return result;
}

// ============================================================================
// Phase: Switch Branch for Execution
// ============================================================================

async function switchToBranch(branch: string): Promise<boolean> {
  try {
    // Fetch the branch
    const { execSync } = await import("node:child_process");
    execSync(`git fetch origin ${branch}`, { stdio: "pipe" });
    execSync(`git checkout ${branch}`, { stdio: "pipe" });
    core.info(`Switched to branch: ${branch}`);
    return true;
  } catch (error) {
    core.warning(`Failed to switch to branch ${branch}: ${error}`);
    return false;
  }
}

// ============================================================================
// Phase: Write Step Summary
// ============================================================================

function writeStepSummary(
  deriveResult: DeriveResult,
  execSuccess: boolean,
  ctx: WorkflowContext,
  dryRun: boolean,
): void {
  const dryRunBadge = dryRun ? " (DRY RUN)" : "";
  const actionsJson = JSON.stringify(deriveResult.pendingActions, null, 2);

  core.summary
    .addHeading(
      `State Machine - ${deriveResult.transitionName}${dryRunBadge}`,
      1,
    )
    .addTable([
      [
        { data: "Property", header: true },
        { data: "Value", header: true },
      ],
      ["Issue", `#${ctx.issue_number || ctx.discussion_number || "?"}`],
      ["Trigger", `\`${ctx.trigger}\``],
      ["Transition", `**${deriveResult.transitionName}**`],
      ["Final State", `\`${deriveResult.finalState}\``],
      ["Actions Derived", String(deriveResult.pendingActions.length)],
      ["Execution", execSuccess ? "✅ Success" : "❌ Failed"],
    ])
    .addHeading("Actions", 2)
    .addCodeBlock(actionsJson, "json")
    .write();
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function run(): Promise<void> {
  try {
    // Parse inputs
    const contextJsonInput = getRequiredInput("context_json");
    const codeToken = getRequiredInput("github_code_token");
    const reviewToken = getOptionalInput("github_review_token") || "";
    const projectNumber = parseInt(
      getOptionalInput("project_number") || "1",
      10,
    );
    const maxRetries = parseInt(getOptionalInput("max_retries") || "5", 10);
    const dryRun = getOptionalInput("dry_run") === "true";
    const continueFlag = getOptionalInput("continue") !== "false";
    const e2eMode = getOptionalInput("e2e_mode") === "true";
    const e2eReviewOutcome =
      getOptionalInput("e2e_review_outcome") || "approved";
    const botUsername = "nopo-bot";

    // Parse workflow context
    const ctx = parseWorkflowContext(contextJsonInput);
    const trigger = ctx.trigger;
    const isDiscussion = checkDiscussionTrigger(trigger);

    core.info("=".repeat(60));
    core.info("State Machine Runner (unified)");
    core.info("=".repeat(60));
    core.info(`Job: ${ctx.job}`);
    core.info(`Trigger: ${trigger}`);
    core.info(`Resource: ${ctx.resource_type} #${ctx.resource_number}`);
    core.info(`Dry run: ${dryRun}`);
    core.info(`E2E mode: ${e2eMode}`);

    // Create octokits
    const codeOctokit = github.getOctokit(codeToken);
    const reviewOctokit = reviewToken
      ? github.getOctokit(reviewToken)
      : undefined;
    const { owner, repo } = github.context.repo;

    // ====================================================================
    // STEP 1: Derive Actions (run state machine)
    // ====================================================================
    core.startGroup("Step 1: Derive Actions");

    let deriveResult: DeriveResult | null;

    if (isDiscussion) {
      deriveResult = await deriveDiscussionActions({
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- checkDiscussionTrigger guard confirms type
        trigger: trigger as DiscussionTriggerType,
        ctx,
        octokit: codeOctokit,
        owner,
        repo,
        maxRetries,
        botUsername,
      });
    } else {
      deriveResult = await deriveIssueActions({
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- non-discussion trigger is TriggerType
        trigger: trigger as TriggerType,
        ctx,
        octokit: codeOctokit,
        owner,
        repo,
        projectNumber,
        maxRetries,
        botUsername,
      });
    }

    if (!deriveResult) {
      core.setFailed("Failed to build machine context");
      return;
    }

    core.info(`Final state: ${deriveResult.finalState}`);
    core.info(`Transition: ${deriveResult.transitionName}`);
    core.info(`Actions: ${deriveResult.pendingActions.length}`);
    if (deriveResult.pendingActions.length > 0) {
      core.info(
        `Types: ${deriveResult.pendingActions.map((a) => a.type).join(", ")}`,
      );
    }
    core.endGroup();

    // ====================================================================
    // STEP 2: Log Run Start (skip for discussions and merge-queue-logging)
    // ====================================================================
    const skipLogging = isDiscussion || ctx.job === "merge-queue-logging";
    const issueNumber = parseInt(
      deriveResult.parentIssueNumber || ctx.issue_number || "0",
      10,
    );

    if (!skipLogging && issueNumber > 0) {
      core.startGroup("Step 2: Log Run Start");

      // Save state for post-cancellation cleanup
      core.saveState("issue_number", String(issueNumber));
      core.saveState("iteration", deriveResult.iteration);
      core.saveState("phase", deriveResult.phase);
      core.saveState("code_token_input", "github_code_token");
      core.saveState("transition_name", deriveResult.transitionName);
      core.saveState("dry_run", String(dryRun));

      await logRunStart(
        codeOctokit,
        owner,
        repo,
        issueNumber,
        parseInt(deriveResult.iteration, 10),
        deriveResult.phase,
        dryRun,
      );
      core.endGroup();
    }

    // ====================================================================
    // STEP 3: Execute Actions
    // ====================================================================
    let execSuccess = true;
    const actions = deriveResult.pendingActions;

    if (actions.length > 0) {
      core.startGroup("Step 3: Execute Actions");

      // Switch to execution branch if needed
      const executionBranch = getExecutionBranch(actions, ctx);
      if (executionBranch) {
        core.info(`Switching to execution branch: ${executionBranch}`);
        const switched = await switchToBranch(executionBranch);
        if (!switched) {
          core.warning(
            `Could not switch to branch ${executionBranch}, continuing on current branch`,
          );
        }
      }

      const result = await executeAllActions(
        actions,
        codeOctokit,
        reviewOctokit,
        owner,
        repo,
        projectNumber,
        dryRun,
        e2eMode,
        e2eReviewOutcome,
      );

      execSuccess = result.success;

      if (!execSuccess) {
        const failedCount = result.results.filter(
          (r) => !r.success && !r.skipped,
        ).length;
        core.error(`${failedCount} action(s) failed`);
      }

      core.endGroup();
    } else {
      core.info("No actions to execute");
    }

    // ====================================================================
    // STEP 4: Log Run End (skip for discussions and merge-queue-logging)
    // ====================================================================
    if (!skipLogging && issueNumber > 0) {
      core.startGroup("Step 4: Log Run End");
      await logRunEnd(
        codeOctokit,
        owner,
        repo,
        issueNumber,
        deriveResult,
        execSuccess,
        dryRun,
      );
      core.endGroup();
    }

    // ====================================================================
    // STEP 5: Set Outputs
    // ====================================================================
    const retrigger =
      execSuccess &&
      !dryRun &&
      shouldRetrigger(deriveResult.finalState, actions, continueFlag);

    setOutputs({
      final_state: deriveResult.finalState,
      transition_name: deriveResult.transitionName,
      actions_json: JSON.stringify(deriveResult.pendingActions),
      action_count: String(deriveResult.pendingActions.length),
      success: String(execSuccess),
      should_retrigger: String(retrigger),
      issue_number: ctx.issue_number || ctx.discussion_number || "",
    });

    // Write step summary
    writeStepSummary(deriveResult, execSuccess, ctx, dryRun);

    // Fail the action if execution failed
    if (!execSuccess) {
      core.setFailed("Action execution failed. Check logs for details.");
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

run();
