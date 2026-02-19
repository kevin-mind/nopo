/**
 * State Machine PEV Action
 *
 * Unified GitHub Action that runs the predict-execute-verify cycle
 * in a single invocation. Creates an XState actor, sends DETECT,
 * and lets the machine run to completion.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { createActor, waitFor } from "xstate";
import { exampleMachine } from "../../src/machines/example/index.js";
import type { ExampleContext } from "../../src/machines/example/context.js";
import { ExampleContextLoader } from "../../src/machines/example/context.js";
import {
  createClaudeGroomingService,
  createClaudeIterationService,
  createClaudePrResponseService,
  createClaudeReviewService,
  createClaudeTriageService,
} from "../../src/machines/example/services.js";
import {
  getRequiredInput,
  getOptionalInput,
  setOutputs,
} from "../../src/core/action-utils.js";
import type { ExampleTrigger } from "../../src/machines/example/events.js";
import {
  issueNumberFromBranch,
  issueNumberFromPR,
  type OctokitLike,
} from "@more/issue-state";

/**
 * Detect the trigger type from the GitHub event context.
 * Maps github.event_name + github.event.action to an ExampleTrigger.
 */
function detectTrigger(ctx: {
  event_name: string;
  event: {
    action?: string;
    inputs?: { trigger_type?: string };
    issue?: { number: number };
    comment?: { body?: string };
    review?: { state?: string };
    workflow_run?: {
      conclusion?: string;
      head_branch?: string;
      pull_requests?: Array<{ number: number }>;
    };
    pull_request?: { number: number };
  };
}): ExampleTrigger | null {
  const eventName = ctx.event_name;
  const action = ctx.event?.action;

  // workflow_dispatch can override trigger via inputs
  if (eventName === "workflow_dispatch") {
    const override = ctx.event?.inputs?.trigger_type;
    if (override) {
      const valid = new Set<string>([
        "issue-triage",
        "issue-assigned",
        "issue-edited",
        "issue-closed",
        "issue-comment",
        "issue-orchestrate",
        "issue-retry",
        "issue-reset",
        "issue-pivot",
        "issue-groom",
        "issue-groom-summary",
        "workflow-run-completed",
        "pr-review",
        "pr-review-requested",
        "pr-review-submitted",
        "pr-review-approved",
        "pr-response",
        "pr-human-response",
        "pr-push",
        "pr-merged",
        "merge-queue-entered",
        "merge-queue-failed",
        "deployed-stage",
        "deployed-prod",
        "deployed-stage-failed",
        "deployed-prod-failed",
      ]);
      if (valid.has(override)) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- validated via Set lookup
        return override as ExampleTrigger;
      }
    }
    return "issue-triage";
  }

  // issues events
  if (eventName === "issues") {
    if (action === "assigned") return "issue-assigned";
    if (action === "edited") return "issue-edited";
    if (action === "closed") return "issue-closed";
    if (action === "opened") return "issue-triage";
    return "issue-triage";
  }

  // issue_comment — check for slash commands
  if (eventName === "issue_comment") {
    const body = ctx.event?.comment?.body ?? "";
    if (/\/(lfg|implement|continue)/.test(body)) return "issue-orchestrate";
    if (/\/retry/.test(body)) return "issue-retry";
    if (/\/reset/.test(body)) return "issue-reset";
    if (/\/pivot/.test(body)) return "issue-pivot";
    return "issue-comment";
  }

  // pull_request events
  if (eventName === "pull_request") {
    if (action === "review_requested") return "pr-review-requested";
    return "pr-push";
  }

  // pull_request_review
  if (eventName === "pull_request_review") {
    const state = ctx.event?.review?.state?.toLowerCase();
    if (state === "approved") return "pr-review-approved";
    if (state === "changes_requested") return "pr-review-submitted";
    return "pr-review-submitted";
  }

  // pull_request_review_comment
  if (eventName === "pull_request_review_comment") {
    return "pr-response";
  }

  // push events only trigger CI — state machine reacts to CI completion via workflow_run
  if (eventName === "push") return null;

  // workflow_run (CI completion)
  if (eventName === "workflow_run") return "workflow-run-completed";

  // merge_group
  if (eventName === "merge_group") return "merge-queue-entered";

  // Default fallback
  return "issue-triage";
}

function asOctokitLike(
  octokit: ReturnType<typeof github.getOctokit>,
): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @actions/github octokit is structurally compatible with OctokitLike
  return octokit as unknown as OctokitLike;
}

async function run(): Promise<void> {
  const token = getRequiredInput("github_token");
  const reviewerToken = getOptionalInput("reviewer_token") || token;
  const maxTransitions = parseInt(
    getOptionalInput("max_transitions") || "1",
    10,
  );
  const projectNumber = parseInt(getOptionalInput("project_number") || "0", 10);
  const githubJsonStr = getRequiredInput("github_json");

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- GitHub context JSON is untyped
  const githubJson = JSON.parse(githubJsonStr) as {
    event: {
      action?: string;
      issue?: { number: number; title: string; body: string };
      inputs?: { resource_number?: string; trigger_type?: string };
      comment?: { body?: string };
      review?: { state?: string };
      workflow_run?: {
        conclusion?: string;
        head_branch?: string;
        pull_requests?: Array<{ number: number }>;
      };
      pull_request?: { number: number };
    };
    repository_owner: string;
    event_name: string;
    repository: string;
  };

  const trigger = detectTrigger(githubJson);

  if (trigger === null) {
    core.info(
      `Event ${githubJson.event_name} skipped (no state machine action needed)`,
    );
    return;
  }

  core.info(`PEV Machine starting (max_transitions=${maxTransitions})`);
  core.info(`Event: ${githubJson.event_name}, Trigger: ${trigger}`);

  // Build a minimal domain context from the GitHub event
  const issueData = githubJson.event?.issue;
  const [owner, repo] = (githubJson.repository ?? "unknown/unknown").split("/");
  const resourceNumberStr = githubJson.event?.inputs?.resource_number;
  let issueNumber =
    (issueData?.number ??
      (resourceNumberStr ? parseInt(resourceNumberStr, 10) : 0)) ||
    0;

  const octokit = github.getOctokit(token);
  const oktLike = asOctokitLike(octokit);
  const ownerStr = owner ?? "unknown";
  const repoStr = repo ?? "unknown";

  // For events without a direct issue reference, resolve via GraphQL
  if (issueNumber === 0) {
    // workflow_run: resolve via head_branch → PR → closing issue
    if (githubJson.event_name === "workflow_run") {
      const headBranch = githubJson.event?.workflow_run?.head_branch;
      if (headBranch) {
        core.info(
          `Resolving issue from workflow_run head_branch: ${headBranch}`,
        );
        const resolved = await issueNumberFromBranch(
          oktLike,
          ownerStr,
          repoStr,
          headBranch,
        );
        if (resolved) {
          issueNumber = resolved;
          core.info(`Resolved issue #${issueNumber} from branch ${headBranch}`);
        } else {
          core.warning(`Could not resolve issue from branch ${headBranch}`);
        }
      }
    }

    // pull_request / pull_request_review: resolve via PR number → closing issue
    if (
      (githubJson.event_name === "pull_request" ||
        githubJson.event_name === "pull_request_review") &&
      githubJson.event?.pull_request?.number
    ) {
      const prNumber = githubJson.event.pull_request.number;
      core.info(`Resolving issue from PR #${prNumber}`);
      const resolved = await issueNumberFromPR(
        oktLike,
        ownerStr,
        repoStr,
        prNumber,
      );
      if (resolved) {
        issueNumber = resolved;
        core.info(`Resolved issue #${issueNumber} from PR #${prNumber}`);
      } else {
        core.warning(`Could not resolve issue from PR #${prNumber}`);
      }
    }
  }
  const loader = new ExampleContextLoader();
  const loaded = await loader.load({
    octokit: oktLike,
    trigger,
    owner: ownerStr,
    repo: repoStr,
    projectNumber: projectNumber || undefined,
    event: {
      type: githubJson.event_name,
      owner: ownerStr,
      repo: repoStr,
      issueNumber,
      timestamp: new Date().toISOString(),
    },
  });
  const loadedContext = loaded ? loader.toContext() : null;
  const domainContext: ExampleContext = loadedContext ?? {
    trigger,
    owner: ownerStr,
    repo: repoStr,
    issue: {
      number: issueNumber,
      title: issueData?.title ?? "Unknown",
      body: issueData?.body ?? "",
      comments: [],
      state: "OPEN",
      projectStatus: null,
      labels: [],
      assignees: [],
      hasSubIssues: false,
      subIssues: [],
      iteration: 0,
      failures: 0,
    },
    parentIssue: null,
    currentSubIssue: null,
    pr: null,
    hasPR: false,
    ciResult: null,
    reviewDecision: null,
    commentContextType: null,
    commentContextDescription: null,
    ciRunUrl: null,
    ciCommitSha: null,
    workflowStartedAt: null,
    workflowRunUrl: null,
    branch: null,
    hasBranch: false,
    botUsername: "nopo-bot",
    triageOutput: null,
  };
  domainContext.services = {
    ...domainContext.services,
    triage: createClaudeTriageService(token),
    grooming: createClaudeGroomingService(token),
    iteration: createClaudeIterationService(token),
    review: createClaudeReviewService(reviewerToken),
    prResponse: createClaudePrResponseService(token),
  };

  const actor = createActor(exampleMachine, {
    input: {
      domain: domainContext,
      maxTransitions,
      runnerCtx: {
        token,
        owner: ownerStr,
        repo: repoStr,
        projectNumber: projectNumber || undefined,
      },
    },
  });

  // Log all state transitions
  actor.subscribe((snapshot) => {
    const state = String(snapshot.value);
    const ctx = snapshot.context;
    core.info(`[state] ${state}`);
    core.info(`[queue] ${ctx.actionQueue.length} actions remaining`);
    core.info(`[transitions] ${ctx.transitionCount}/${ctx.maxTransitions}`);
  });

  actor.start();
  actor.send({ type: "DETECT" });

  // Wait for the machine to reach a final state
  const finalSnapshot = await waitFor(actor, (s) => s.status === "done", {
    timeout: 300_000, // 5 minutes
  });

  const finalState = String(finalSnapshot.value);
  const ctx = finalSnapshot.context;

  core.info(`[final] state=${finalState}`);
  core.info(`[final] ${ctx.completedActions.length} actions executed`);
  if (ctx.error) {
    core.warning(`[final] error: ${ctx.error}`);
  }

  setOutputs({
    final_state: finalState,
    actions_executed: String(ctx.completedActions.length),
    error: ctx.error ?? "",
  });
}

run().catch((err) => {
  process.exitCode = 1;
  throw err;
});
