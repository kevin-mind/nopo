import { describe, it, expect } from "vitest";
import { createActor, waitFor } from "xstate";
import { exampleMachine } from "../../src/machines/example/machine.js";
import type { ExampleContext } from "../../src/machines/example/context.js";
import type { ExternalRunnerContext } from "../../src/core/pev/types.js";
import { mockExampleContext, mockExampleIssue } from "./mock-factories.js";

const RUNNER_CTX: ExternalRunnerContext = {
  token: "test-token",
  owner: "test-owner",
  repo: "test-repo",
};

async function run(domain: ExampleContext) {
  const withServices: ExampleContext = {
    ...domain,
    services: {
      ...domain.services,
      iteration: domain.services?.iteration ?? {
        iterateIssue: async () => ({
          labelsToAdd: ["iteration:ready"],
          summary: "iteration ready",
        }),
      },
      review: domain.services?.review ?? {
        reviewIssue: async () => ({
          labelsToAdd: ["reviewed"],
          summary: "reviewed",
        }),
      },
      prResponse: domain.services?.prResponse ?? {
        respondToPr: async () => ({
          labelsToAdd: ["response-prepared"],
          summary: "response prepared",
        }),
      },
    },
  };
  const actor = createActor(exampleMachine, {
    input: { domain: withServices, maxTransitions: 30, runnerCtx: RUNNER_CTX },
  });
  actor.start();
  actor.send({ type: "DETECT" });
  return waitFor(actor, (s) => s.status === "done", { timeout: 5000 });
}

function hasActionType(
  snapshot: Awaited<ReturnType<typeof run>>,
  type: string,
) {
  return snapshot.context.completedActions.some((a) => a.action.type === type);
}

function hasHistoryMessage(
  snapshot: Awaited<ReturnType<typeof run>>,
  expected: string,
) {
  return snapshot.context.completedActions.some((a) => {
    if (a.action.type !== "appendHistory") return false;
    if (!("payload" in a.action) || typeof a.action.payload !== "object") {
      return false;
    }
    if (a.action.payload === null) return false;
    return Reflect.get(a.action.payload, "message") === expected;
  });
}

describe("Example Machine — state matrix hardening", () => {
  const baseDomain = {
    owner: "test-owner",
    repo: "test-repo",
    issue: mockExampleIssue({
      number: 42,
      labels: ["triaged", "groomed"],
      projectStatus: "In progress",
    }),
  } satisfies Parameters<typeof mockExampleContext>[0];

  it("handles reset trigger with explicit reset actions", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "issue-reset" }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasActionType(snap, "updateStatus")).toBe(true);
    expect(hasHistoryMessage(snap, "Issue reset to backlog")).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("Backlog");
  });

  it("handles retry trigger with retry queue", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "issue-retry" }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasActionType(snap, "runClaudeIteration")).toBe(true);
    expect(hasActionType(snap, "applyIterationOutput")).toBe(true);
    expect(hasHistoryMessage(snap, "Retry requested, resuming iteration")).toBe(
      true,
    );
    expect(snap.context.domain.issue.projectStatus).toBe("In progress");
  });

  it("handles pivot trigger by blocking current path", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "issue-pivot" }),
    );
    expect(String(snap.value)).toBe("done");
    expect(
      hasHistoryMessage(
        snap,
        "Pivot requested, blocking current path for replanning",
      ),
    ).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("Blocked");
  });

  it("handles comment trigger with comment-context history", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "issue-comment",
        commentContextDescription: "User asked to summarize progress",
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(
      hasHistoryMessage(
        snap,
        "Issue comment trigger received (User asked to summarize progress)",
      ),
    ).toBe(true);
  });

  it("handles PR response trigger with agent response path", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "pr-response" }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasActionType(snap, "runClaudePrResponse")).toBe(true);
    expect(hasActionType(snap, "applyPrResponseOutput")).toBe(true);
    expect(hasHistoryMessage(snap, "Prepared automated PR response")).toBe(
      true,
    );
  });

  it("handles PR human response trigger with explicit history", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "pr-human-response" }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasHistoryMessage(snap, "Human PR response required")).toBe(true);
  });

  it("handles PR review trigger with review history when CI passed", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "pr-review",
        ciResult: "success",
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasActionType(snap, "runClaudeReview")).toBe(true);
    expect(hasActionType(snap, "applyReviewOutput")).toBe(true);
    expect(hasHistoryMessage(snap, "PR review workflow requested")).toBe(true);
  });

  it("routes pr-review to prReviewAssigned when CI not failed (no-op)", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "pr-review" }),
    );
    expect(String(snap.value)).toBe("prReviewAssigned");
    expect(snap.context.completedActions).toHaveLength(0);
  });

  it("routes to alreadyBlocked when issue is already blocked (no-op)", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "issue-edited",
        issue: mockExampleIssue({
          number: 42,
          labels: ["triaged", "groomed"],
          projectStatus: "Blocked",
        }),
      }),
    );
    expect(String(snap.value)).toBe("alreadyBlocked");
    expect(snap.context.completedActions).toHaveLength(0);
  });

  it("routes pr-review to prReviewSkipped when CI failed (no-op)", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "pr-review",
        ciResult: "failure",
      }),
    );
    expect(String(snap.value)).toBe("prReviewSkipped");
    expect(snap.context.completedActions).toHaveLength(0);
  });

  it("routes to iteratingFix queue when CI fails (fix-CI path)", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      labels: ["triaged", "groomed"],
      hasSubIssues: true,
    });
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "workflow-run-completed",
        ciResult: "failure",
        issue: mockExampleIssue({
          number: 100,
          assignees: ["nopo-bot"],
          labels: ["triaged", "groomed"],
        }),
        parentIssue,
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasHistoryMessage(snap, "CI failed, returning to iteration")).toBe(
      true,
    );
    expect(hasHistoryMessage(snap, "Fixing CI")).toBe(true);
    expect(hasActionType(snap, "runClaudeIteration")).toBe(true);
    expect(hasActionType(snap, "recordFailure")).toBe(true);
  });

  it("routes to iteratingFix queue when review requests changes", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      labels: ["triaged", "groomed"],
      hasSubIssues: true,
    });
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "pr-review-submitted",
        reviewDecision: "CHANGES_REQUESTED",
        issue: mockExampleIssue({
          number: 100,
          assignees: ["nopo-bot"],
          labels: ["triaged", "groomed"],
        }),
        parentIssue,
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(
      hasHistoryMessage(
        snap,
        "Review requested changes, returning to iteration",
      ),
    ).toBe(true);
    expect(hasHistoryMessage(snap, "Fixing CI")).toBe(true);
    expect(hasActionType(snap, "runClaudeIteration")).toBe(true);
  });

  it("routes to transitioningToReview when CI passed and todos done", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "workflow-run-completed",
        ciResult: "success",
        issue: mockExampleIssue({
          number: 42,
          labels: ["triaged", "groomed"],
          projectStatus: "In progress",
          body: "## Todos\n- [x] Task 1\n- [x] Task 2",
        }),
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasHistoryMessage(snap, "CI passed, transitioning to review")).toBe(
      true,
    );
    expect(snap.context.domain.issue.projectStatus).toBe("In review");
  });

  it("handles PR push trigger with iteration status reset", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "pr-push",
        issue: mockExampleIssue({
          number: 42,
          labels: ["triaged", "groomed"],
          projectStatus: "In review",
        }),
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(
      hasHistoryMessage(
        snap,
        "PR updated by push; awaiting CI and review loop",
      ),
    ).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("In progress");
  });

  it("handles orchestration trigger with orchestration queue", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "issue-orchestrate",
        issue: mockExampleIssue({
          number: 42,
          labels: ["triaged", "groomed"],
          projectStatus: "In progress",
          hasSubIssues: true,
          subIssues: [
            { number: 100, projectStatus: "Backlog", state: "OPEN" },
          ],
        }),
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasActionType(snap, "runOrchestration")).toBe(true);
    expect(hasHistoryMessage(snap, "Orchestration command processed")).toBe(
      true,
    );
  });

  it("routes parent issue with active review phase to orchestration waiting", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "issue-edited",
        issue: mockExampleIssue({
          number: 42,
          labels: ["triaged", "groomed"],
          projectStatus: "In progress",
          hasSubIssues: true,
          subIssues: [
            { number: 100, projectStatus: "In review", state: "OPEN" },
            { number: 101, projectStatus: "Backlog", state: "OPEN" },
          ],
        }),
        parentIssue: null,
        currentSubIssue: mockExampleIssue({
          number: 100,
          projectStatus: "In review",
          hasSubIssues: false,
        }),
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(
      hasHistoryMessage(
        snap,
        "Current phase is in review; waiting for merge before advancing",
      ),
    ).toBe(true);
  });

  it("routes parent issue with completed phases to orchestration complete", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "issue-edited",
        issue: mockExampleIssue({
          number: 42,
          labels: ["triaged", "groomed"],
          projectStatus: "In progress",
          hasSubIssues: true,
          subIssues: [
            { number: 100, projectStatus: "Done", state: "CLOSED" },
            { number: 101, projectStatus: "Done", state: "CLOSED" },
          ],
        }),
        parentIssue: null,
        currentSubIssue: null,
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(snap.context.domain.issue.projectStatus).toBe("Done");
    expect(hasActionType(snap, "persistState")).toBe(true);
    expect(hasHistoryMessage(snap, "All sub-issue phases are complete")).toBe(
      true,
    );
  });

  it("handles merge queue entered trigger with explicit history", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "merge-queue-entered" }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasHistoryMessage(snap, "Issue entered merge queue")).toBe(true);
  });

  it("handles merge queue failed trigger as error", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "merge-queue-failed" }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasHistoryMessage(snap, "Merge queue failed")).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("Error");
  });

  it("handles pr-merged trigger with merge queue", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "pr-merged",
        issue: mockExampleIssue({
          labels: ["triaged", "groomed"],
          projectStatus: "In review",
          hasSubIssues: false,
        }),
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasActionType(snap, "updateStatus")).toBe(true);
    expect(hasHistoryMessage(snap, "PR merged, issue marked done")).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("Done");
  });

  it("handles pr-merged with sub-issues runs orchestration after merge", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "pr-merged",
        issue: mockExampleIssue({
          labels: ["triaged", "groomed"],
          projectStatus: "In review",
          hasSubIssues: true,
          subIssues: [
            { number: 100, projectStatus: "Done", state: "CLOSED" },
            { number: 101, projectStatus: "Backlog", state: "OPEN" },
          ],
        }),
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasActionType(snap, "runOrchestration")).toBe(true);
    expect(hasHistoryMessage(snap, "Orchestration command processed")).toBe(
      true,
    );
  });

  it("handles deployed-stage trigger with logging", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "deployed-stage" }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasHistoryMessage(snap, "Deployment to stage succeeded")).toBe(true);
  });

  it("handles deployed-prod trigger with done status", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "deployed-prod" }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasHistoryMessage(snap, "Deployment to production succeeded")).toBe(
      true,
    );
    expect(snap.context.domain.issue.projectStatus).toBe("Done");
  });

  it("handles deployed-stage-failed trigger with error status", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "deployed-stage-failed" }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasHistoryMessage(snap, "Deployment to stage failed")).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("Error");
  });

  it("handles deployed-prod-failed trigger with error status", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "deployed-prod-failed" }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasHistoryMessage(snap, "Deployment to production failed")).toBe(
      true,
    );
    expect(snap.context.domain.issue.projectStatus).toBe("Error");
  });
});
