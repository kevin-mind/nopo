/**
 * State Machine PEV Action
 *
 * Unified GitHub Action that runs the predict-execute-verify cycle
 * in a single invocation. Creates an XState actor, sends DETECT,
 * and lets the machine run to completion.
 *
 * Expects issue_number, trigger, owner, and repo to be resolved
 * upstream by sm-context.
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { createActor, waitFor } from "xstate";
import { exampleMachine } from "../../src/machines/example/index.js";
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
import { z } from "zod";
import { type OctokitLike } from "@more/issue-state";

function asOctokitLike(
  octokit: ReturnType<typeof github.getOctokit>,
): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- @actions/github octokit is structurally compatible with OctokitLike
  return octokit as unknown as OctokitLike;
}

const ActionInputSchema = z.object({
  github_token: z.string().min(1, "github_token is required"),
  reviewer_token: z.string().min(1).optional(),
  max_cycles: z
    .string()
    .default("1")
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1, "max_cycles must be >= 1")),
  project_number: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(
      z
        .number()
        .int()
        .min(
          1,
          "project_number is required (set vars.PROJECT_NUMBER). Without it, parentIssue resolution fails and sub-issues get re-groomed.",
        ),
    ),
  issue_number: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().min(1, "issue_number must be >= 1")),
  trigger: z.string().min(1, "trigger is required"),
  owner: z.string().min(1, "owner is required"),
  repo: z.string().min(1, "repo is required"),
});

async function run(): Promise<void> {
  const inputs = ActionInputSchema.parse({
    github_token: getRequiredInput("github_token"),
    reviewer_token: getOptionalInput("reviewer_token") || undefined,
    max_cycles: getOptionalInput("max_cycles") || "1",
    project_number: getOptionalInput("project_number") || "0",
    issue_number: getRequiredInput("issue_number"),
    trigger: getRequiredInput("trigger"),
    owner: getRequiredInput("owner"),
    repo: getRequiredInput("repo"),
  });

  const token = inputs.github_token;
  const reviewerToken = inputs.reviewer_token ?? token;
  const maxCycles = inputs.max_cycles;
  const projectNumber = inputs.project_number;
  const issueNumber = inputs.issue_number;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- validated upstream by sm-context
  const trigger = inputs.trigger as ExampleTrigger;
  const owner = inputs.owner;
  const repo = inputs.repo;

  core.info(`PEV Machine starting (max_cycles=${maxCycles})`);
  core.info(`Issue: #${issueNumber}, Trigger: ${trigger}`);

  const octokit = github.getOctokit(token);
  const oktLike = asOctokitLike(octokit);

  const loader = new ExampleContextLoader();
  const loaded = await loader.load({
    octokit: oktLike,
    trigger,
    owner,
    repo,
    projectNumber,
    event: {
      type: trigger,
      owner,
      repo,
      issueNumber,
      timestamp: new Date().toISOString(),
    },
  });

  if (!loaded) {
    throw new Error(
      `Failed to load context for issue #${issueNumber} (trigger=${trigger}, owner=${owner}, repo=${repo})`,
    );
  }

  const domainContext = loader.toContext();
  const services = {
    triage: createClaudeTriageService(token),
    grooming: createClaudeGroomingService(token),
    iteration: createClaudeIterationService(token),
    review: createClaudeReviewService(reviewerToken),
    prResponse: createClaudePrResponseService(token),
  };

  const actor = createActor(exampleMachine, {
    input: {
      domain: domainContext,
      maxCycles,
      runnerCtx: {
        token,
        owner,
        repo,
        projectNumber,
      },
      services,
    },
  });

  // Log all state transitions
  actor.subscribe((snapshot) => {
    const state = String(snapshot.value);
    const ctx = snapshot.context;
    core.info(`[state] ${state}`);
    core.info(`[queue] ${ctx.actionQueue.length} actions remaining`);
    core.info(`[cycles] ${ctx.cycleCount}/${ctx.maxCycles}`);
  });

  actor.start();

  // Wait for the machine to reach a final state
  const finalSnapshot = await waitFor(actor, (s) => s.status === "done", {
    timeout: 600_000, // 10 minutes
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
