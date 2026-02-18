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
import type { OctokitLike } from "@more/issue-state";

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
  const githubJsonStr = getRequiredInput("github_json");

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- GitHub context JSON is untyped
  const githubJson = JSON.parse(githubJsonStr) as {
    event: {
      issue?: { number: number; title: string; body: string };
      inputs?: { resource_number?: string };
    };
    repository_owner: string;
    event_name: string;
    repository: string;
  };

  core.info(`PEV Machine starting (max_transitions=${maxTransitions})`);
  core.info(`Event: ${githubJson.event_name}`);

  // Build a minimal domain context from the GitHub event
  const issueData = githubJson.event?.issue;
  const [owner, repo] = (githubJson.repository ?? "unknown/unknown").split("/");
  const resourceNumberStr = githubJson.event?.inputs?.resource_number;
  const issueNumber =
    (issueData?.number ??
      (resourceNumberStr ? parseInt(resourceNumberStr, 10) : 0)) ||
    0;
  const octokit = github.getOctokit(token);
  const loader = new ExampleContextLoader();
  const loaded = await loader.load({
    octokit: asOctokitLike(octokit),
    trigger: "issue-triage",
    owner: owner ?? "unknown",
    repo: repo ?? "unknown",
    event: {
      type: githubJson.event_name,
      owner: owner ?? "unknown",
      repo: repo ?? "unknown",
      issueNumber,
      timestamp: new Date().toISOString(),
    },
  });
  const loadedContext = loaded ? loader.toContext() : null;
  const domainContext: ExampleContext = loadedContext ?? {
    trigger: "issue-triage",
    owner: owner ?? "unknown",
    repo: repo ?? "unknown",
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
        owner: owner ?? "unknown",
        repo: repo ?? "unknown",
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
