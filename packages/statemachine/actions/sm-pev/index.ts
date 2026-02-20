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

  // Log meaningful state transitions
  let lastState = "";
  let pendingVerify: {
    action: string;
    prediction: typeof ctx.prediction;
  } | null = null;
  actor.subscribe((snapshot) => {
    const ctx = snapshot.context;
    const stateKey =
      typeof snapshot.value === "object"
        ? Object.values(snapshot.value as Record<string, string>).join(".")
        : String(snapshot.value);

    // Deduplicate: only log when state actually changes
    if (stateKey === lastState) return;
    lastState = stateKey;

    // When leaving verifying state, log the verify result
    if (pendingVerify && stateKey !== "verifying") {
      const { action: verifiedAction, prediction: pred } = pendingVerify;
      const result = ctx.verifyResult;
      const icon = result?.pass === false ? "✗" : "✓";
      const desc = pred?.description ? `: ${pred.description}` : "";
      const checkLines = (pred?.checks ?? [])
        .map((c) => {
          const diff = result?.diffs?.find((d) => d.field === c.field);
          if (diff) {
            return `    ✗ ${c.description ?? c.field} (expected: ${JSON.stringify(diff.expected)}, actual: ${JSON.stringify(diff.actual)})`;
          }
          return `    ✓ ${c.description ?? c.field}`;
        })
        .join("\n");
      core.info(
        `[verify] ${icon} ${verifiedAction}${desc}${checkLines ? `\n${checkLines}` : ""}`,
      );
      if (result?.pass === false && result.message) {
        core.warning(`[verify] ${result.message}`);
      }
      pendingVerify = null;
    }

    const action = ctx.currentAction?.type ?? "—";
    const queued = ctx.actionQueue.map((a) => a.type).join(" → ");
    const cycle = `cycle ${ctx.cycleCount + 1}/${ctx.maxCycles}`;

    if (stateKey === "executing") {
      core.info(
        `[exec] ${action} (${cycle}${queued ? `, next: ${queued}` : ""})`,
      );
    } else if (stateKey === "verifying") {
      pendingVerify = { action, prediction: ctx.prediction };
    } else if (stateKey === "done") {
      core.info(
        `[done] ${ctx.completedActions.length} actions executed over ${ctx.cycleCount} cycles`,
      );
    } else {
      core.info(`[${stateKey}] action=${action}, ${cycle}`);
    }
  });

  actor.start();

  // Wait for the machine to reach a final state
  const finalSnapshot = await waitFor(actor, (s) => s.status === "done", {
    timeout: 600_000, // 10 minutes
  });

  const ctx = finalSnapshot.context;
  const finalState =
    typeof finalSnapshot.value === "object"
      ? Object.values(finalSnapshot.value as Record<string, string>).join(".")
      : String(finalSnapshot.value);

  if (ctx.error) {
    core.warning(`[error] ${ctx.error}`);
  }

  // Summary: list all actions that ran
  const actionList = ctx.completedActions
    .map((a) => `  ${a.verified ? "✓" : "✗"} ${a.action.type}`)
    .join("\n");
  core.info(`[summary]\n${actionList}`);

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
