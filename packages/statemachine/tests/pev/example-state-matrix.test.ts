import { describe, it, expect } from "vitest";
import { createActor, waitFor } from "xstate";
import { exampleMachine } from "../../src/machines/example/machine.js";
import type { ExampleContext } from "../../src/machines/example/context.js";
import type { ExternalRunnerContext } from "../../src/core/pev/types.js";
import {
  mockExampleContext,
  mockExampleIssue,
  mockExampleServices,
} from "./mock-factories.js";

const RUNNER_CTX: ExternalRunnerContext = {
  token: "test-token",
  owner: "test-owner",
  repo: "test-repo",
};

async function run(domain: ExampleContext, maxCycles = 1) {
  // Clear GITHUB_ACTIONS so git actions use their fast (skipped) path in CI
  const origGHA = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = "";
  try {
    const actor = createActor(exampleMachine, {
      input: {
        domain,
        maxCycles,
        runnerCtx: RUNNER_CTX,
        services: mockExampleServices(),
      },
    });
    actor.start();
    return await waitFor(actor, (s) => s.status === "done", { timeout: 5000 });
  } finally {
    process.env.GITHUB_ACTIONS = origGHA;
  }
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
  // Auto-history writes entries to the domain issue body (not completedActions)
  return snapshot.context.domain.issue.body.includes(expected);
}

describe("Example Machine — state matrix hardening", () => {
  // Parent issue that's validly "In progress" — needs active sub-issues
  // so milestone computes "working" → "In progress" (no fixState).
  const baseDomain = {
    owner: "test-owner",
    repo: "test-repo",
    issue: mockExampleIssue({
      number: 42,
      projectStatus: "In progress",
      hasSubIssues: true,
      subIssues: [{ number: 100, projectStatus: "In progress", state: "OPEN" }],
    }),
  } satisfies Parameters<typeof mockExampleContext>[0];

  it("handles reset trigger with explicit reset actions", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "issue-reset" }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasActionType(snap, "updateStatus")).toBe(true);
    // Auto-history writes queue label "reset" and action message "Status → Backlog"
    expect(hasHistoryMessage(snap, "reset")).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("Backlog");
  });

  it("handles retry trigger with retry queue", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      hasSubIssues: true,
    });
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "issue-retry",
        issue: mockExampleIssue({
          number: 42,
          projectStatus: "In progress",
          assignees: ["nopo-bot"],
        }),
        parentIssue,
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasActionType(snap, "runClaudeIteration")).toBe(true);
    expect(hasActionType(snap, "applyIterationOutput")).toBe(true);
    // Auto-history writes queue label "retry"
    expect(hasHistoryMessage(snap, "retry")).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("In progress");
  });

  it("handles pivot trigger by blocking current path", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "issue-pivot" }),
    );
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "pivot"
    expect(hasHistoryMessage(snap, "pivot")).toBe(true);
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
    // Auto-history writes queue label "comment"
    expect(hasHistoryMessage(snap, "comment")).toBe(true);
  });

  it("handles PR response trigger with agent response path", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "pr-response" }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasActionType(snap, "runClaudePrResponse")).toBe(true);
    expect(hasActionType(snap, "applyPrResponseOutput")).toBe(true);
    // Auto-history writes action messages from PR response
    expect(hasHistoryMessage(snap, "PR response")).toBe(true);
  });

  it("handles PR human response trigger with explicit history", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "pr-human-response" }),
    );
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "review" for PR human response
    expect(hasHistoryMessage(snap, "review")).toBe(true);
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
    // Auto-history writes queue label "review"
    expect(hasHistoryMessage(snap, "review")).toBe(true);
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
      hasSubIssues: true,
    });
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "workflow-run-completed",
        ciResult: "failure",
        issue: mockExampleIssue({
          number: 100,
          projectStatus: "In progress",
          assignees: ["nopo-bot"],
        }),
        parentIssue,
      }),
    );
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "iterate" (iterateFixQueue)
    expect(hasHistoryMessage(snap, "iterate")).toBe(true);
    expect(hasActionType(snap, "runClaudeIteration")).toBe(true);
    expect(hasActionType(snap, "recordFailure")).toBe(true);
  });

  it("routes to iteratingFix queue when review requests changes", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      hasSubIssues: true,
    });
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "pr-review-submitted",
        reviewDecision: "CHANGES_REQUESTED",
        issue: mockExampleIssue({
          number: 100,
          projectStatus: "In progress",
          assignees: ["nopo-bot"],
        }),
        parentIssue,
      }),
    );
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "iterate" (iterateFixQueue)
    expect(hasHistoryMessage(snap, "iterate")).toBe(true);
    expect(hasActionType(snap, "runClaudeIteration")).toBe(true);
  });

  it("routes to transitioningToReview when CI passed and todos done", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      hasSubIssues: true,
    });
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "workflow-run-completed",
        ciResult: "success",
        issue: mockExampleIssue({
          number: 42,
          projectStatus: "In progress",
          assignees: ["nopo-bot"],
          body: "## Todos\n- [x] Task 1\n- [x] Task 2",
        }),
        parentIssue,
      }),
      2, // needs 2 cycles: transitioningToReview (rebase) → completingReviewTransition
    );
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "review"
    expect(hasHistoryMessage(snap, "review")).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("In review");
  });

  it("routes to iterating when CI passed but todos not done", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      hasSubIssues: true,
    });
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "workflow-run-completed",
        ciResult: "success",
        issue: mockExampleIssue({
          number: 42,
          projectStatus: "In progress",
          assignees: ["nopo-bot"],
          body: "## Todos\n- [x] Task 1\n- [ ] Task 2",
        }),
        parentIssue,
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasActionType(snap, "runClaudeIteration")).toBe(true);
  });

  it("routes to awaitingReview when status is already In review", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      hasSubIssues: true,
    });
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "issue-edited",
        issue: mockExampleIssue({
          number: 42,
          projectStatus: "In review",
        }),
        parentIssue,
      }),
    );
    // awaitingReview re-requests reviewer if PR exists, then done
    expect(String(snap.value)).toBe("done");
    expect(snap.context.completedActions).toHaveLength(0);
  });

  it("handles PR push trigger with iteration status reset", async () => {
    const parentIssue = mockExampleIssue({
      number: 99,
      projectStatus: "In progress",
      hasSubIssues: true,
    });
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "pr-push",
        pr: { state: "OPEN", isDraft: false },
        issue: mockExampleIssue({
          number: 42,
          projectStatus: "In review",
        }),
        parentIssue,
      }),
    );
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "iterate" for PR push
    expect(hasHistoryMessage(snap, "iterate")).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("In progress");
  });

  it("handles orchestration trigger with orchestration queue", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "issue-orchestrate",
        issue: mockExampleIssue({
          number: 42,
          projectStatus: "Groomed",
          hasSubIssues: true,
          subIssues: [{ number: 100, projectStatus: "Backlog", state: "OPEN" }],
        }),
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasActionType(snap, "runOrchestration")).toBe(true);
    // Auto-history writes queue label "orchestrate"
    expect(hasHistoryMessage(snap, "orchestrate")).toBe(true);
  });

  it("routes parent issue with active review phase to orchestration waiting", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "issue-edited",
        issue: mockExampleIssue({
          number: 42,
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
    // Auto-history writes queue label "orchestrate"
    expect(hasHistoryMessage(snap, "orchestrate")).toBe(true);
  });

  it("routes parent issue with completed phases to orchestration complete", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "issue-edited",
        issue: mockExampleIssue({
          number: 42,
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
    expect(hasActionType(snap, "updateStatus")).toBe(true);
    // Auto-history writes queue label "orchestrate"
    expect(hasHistoryMessage(snap, "orchestrate")).toBe(true);
  });

  it("handles merge queue entered trigger with explicit history", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "merge-queue-entered" }),
    );
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "merge"
    expect(hasHistoryMessage(snap, "merge")).toBe(true);
  });

  it("handles merge queue failed trigger as error", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "merge-queue-failed" }),
    );
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "merge" and action message "Status → Error"
    expect(hasHistoryMessage(snap, "merge")).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("Error");
  });

  it("handles pr-merged trigger with merge queue", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "pr-merged",
        issue: mockExampleIssue({
          projectStatus: "In review",
          hasSubIssues: false,
        }),
      }),
    );
    expect(String(snap.value)).toBe("done");
    expect(hasActionType(snap, "updateStatus")).toBe(true);
    // Auto-history writes queue label "merge" and action message "Status → Done"
    expect(hasHistoryMessage(snap, "merge")).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("Done");
  });

  it("handles pr-merged with sub-issues runs orchestration after merge", async () => {
    const snap = await run(
      mockExampleContext({
        ...baseDomain,
        trigger: "pr-merged",
        issue: mockExampleIssue({
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
    // Auto-history writes queue label "merge" (orchestration is part of merge queue)
    expect(hasHistoryMessage(snap, "merge")).toBe(true);
  });

  it("handles deployed-stage trigger with logging", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "deployed-stage" }),
    );
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "deploy"
    expect(hasHistoryMessage(snap, "deploy")).toBe(true);
  });

  it("handles deployed-prod trigger with done status", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "deployed-prod" }),
    );
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "deploy" and action message "Status → Done"
    expect(hasHistoryMessage(snap, "deploy")).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("Done");
  });

  it("handles deployed-stage-failed trigger with error status", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "deployed-stage-failed" }),
    );
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "deploy" and action message "Status → Error"
    expect(hasHistoryMessage(snap, "deploy")).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("Error");
  });

  it("handles deployed-prod-failed trigger with error status", async () => {
    const snap = await run(
      mockExampleContext({ ...baseDomain, trigger: "deployed-prod-failed" }),
    );
    expect(String(snap.value)).toBe("done");
    // Auto-history writes queue label "deploy" and action message "Status → Error"
    expect(hasHistoryMessage(snap, "deploy")).toBe(true);
    expect(snap.context.domain.issue.projectStatus).toBe("Error");
  });
});
