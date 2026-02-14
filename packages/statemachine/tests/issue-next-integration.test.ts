/**
 * Realistic integration tests for the invoke-based issue machine.
 *
 * Simulates real GitHub event flows with mock state:
 * - Human opens issue -> triage -> grooming -> iteration -> CI -> review -> merge -> done
 * - CI failures, circuit breakers, retries, pivots
 * - Multi-phase orchestration with sub-issues
 * - PR review responses, push-to-draft
 *
 * Uses @more/mock-factory for composable fixtures.
 */

import { describe, it, expect, vi } from "vitest";
import { parseMarkdown } from "@more/issue-state";
import { createMockFactory } from "@more/mock-factory";
import { createMachineContext } from "../src/schemas/state.js";
import type { MachineContext, Action } from "../src/schemas/index.js";
import type { Logger } from "../src/core/types.js";

import {
  IssueMachine,
  MachineVerifier,
} from "../src/machines/issue-next-invoke/index.js";
import { predictFromActions } from "../src/verify/predict.js";
import { extractPredictableTree } from "../src/verify/predictable-state.js";

function createMockLogger(): Logger & {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };
}

// ============================================================================
// Mock Factories -- realistic GitHub entities
// ============================================================================

type Issue = MachineContext["issue"];
type SubIssue = NonNullable<MachineContext["currentSubIssue"]>;
type LinkedPR = NonNullable<MachineContext["pr"]>;

const createIssue = createMockFactory<Issue>({
  number: 42,
  title: "feat: Add OAuth 2.0 authentication",
  state: "OPEN",
  // @ts-expect-error -- mdast Root vs Zod-inferred bodyAst type mismatch (data?: RootData vs undefined)
  bodyAst: parseMarkdown(
    [
      "## Description",
      "Add OAuth 2.0 authentication with Google and GitHub providers.",
      "",
      "## Todos",
      "- [ ] Research OAuth providers",
      "- [ ] Implement auth middleware",
      "- [ ] Add login/logout UI",
      "",
      "## Iteration History",
      "",
    ].join("\n"),
  ),
  projectStatus: "Backlog",
  iteration: 0,
  failures: 0,
  assignees: [],
  labels: [],
  subIssues: [],
  hasSubIssues: false,
  comments: [],
  branch: null,
  pr: null,
  parentIssueNumber: null,
});

const createSubIssueData = createMockFactory<SubIssue>({
  number: 100,
  title: "[Phase 1]: Setup auth infrastructure",
  state: "OPEN",
  // @ts-expect-error -- mdast Root vs Zod-inferred bodyAst type mismatch
  bodyAst: parseMarkdown(
    [
      "## Description",
      "Set up OAuth 2.0 middleware and provider configuration.",
      "",
      "## Todos",
      "- [ ] Install passport.js",
      "- [ ] Configure Google OAuth strategy",
      "- [ ] Add session management",
      "",
    ].join("\n"),
  ),
  projectStatus: null,
  assignees: [],
  labels: [],
  branch: null,
  pr: null,
});

type IssueComment = Issue["comments"][number];

const createComment = createMockFactory<IssueComment>({
  id: "IC_1",
  author: "developer-alice",
  body: "placeholder comment",
  createdAt: "2026-02-14T10:00:00Z",
  isBot: false,
});

const createPR = createMockFactory<LinkedPR>({
  number: 10,
  title: "feat: setup auth infrastructure",
  state: "OPEN",
  isDraft: true,
  headRef: "claude/issue/42",
  baseRef: "main",
  labels: [],
  reviews: [],
});

const createContext = createMockFactory<MachineContext>({
  trigger: "issue-edited",
  owner: "acme-corp",
  repo: "platform",
  // @ts-expect-error -- mdast Root vs Zod-inferred bodyAst type mismatch (propagated from createIssue)
  issue: createIssue(),
  parentIssue: null,
  currentPhase: null,
  totalPhases: 0,
  currentSubIssue: null,
  ciResult: null,
  ciRunUrl: null,
  ciCommitSha: null,
  workflowStartedAt: null,
  workflowRunUrl: null,
  reviewDecision: null,
  reviewerId: null,
  branch: null,
  hasBranch: false,
  pr: null,
  hasPR: false,
  maxRetries: 5,
  botUsername: "nopo-bot",
});

// ============================================================================
// Test Helper
// ============================================================================

interface RunResult {
  state: string;
  actions: Action[];
  actionTypes: string[];
}

function runMachine(context: MachineContext): RunResult {
  const result = new IssueMachine(context, {
    logger: createMockLogger(),
  }).run();

  return {
    state: result.state,
    actions: result.actions,
    actionTypes: result.actions.map((a) => a.type),
  };
}

function actionsByType(actions: Action[], type: string): Action[] {
  return actions.filter((a) => a.type === type);
}

function firstAction<T extends Action>(actions: Action[], type: string): T {
  const found = actions.find((a) => a.type === type);
  if (!found) throw new Error(`No action of type "${type}" found`);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return found as T;
}

// ============================================================================
// Scenario 1: Fresh Issue Lifecycle (triage -> groom -> iterate -> review -> done)
// ============================================================================

describe("scenario: fresh issue lifecycle", () => {
  it("step 1: new issue triggers triage", () => {
    const context = createContext({
      trigger: "issue-triage",
      issue: createIssue({ labels: [], projectStatus: "Backlog" }),
    });

    const result = runMachine(context);

    expect(result.state).toBe("triaging");
    expect(result.actionTypes).not.toContain("log");
    expect(result.actionTypes).toContain("runClaude");
    expect(result.actionTypes).toContain("applyTriageOutput");

    const claudeAction = firstAction(result.actions, "runClaude");
    expect(claudeAction).toMatchObject({
      type: "runClaude",
      promptDir: "triage",
    });
  });

  it("step 2: triaged issue triggers grooming", () => {
    const context = createContext({
      trigger: "issue-groom",
      issue: createIssue({
        labels: ["triaged", "enhancement", "P1"],
        projectStatus: "Backlog",
      }),
    });

    const result = runMachine(context);

    expect(result.state).toBe("grooming");
    expect(result.actionTypes).toContain("runClaudeGrooming");
    expect(result.actionTypes).toContain("applyGroomingOutput");
    expect(result.actionTypes).toContain("reconcileSubIssues");
    expect(result.actionTypes).toContain("appendHistory");
  });

  it("step 3: groomed sub-issue with bot assigned starts iteration", () => {
    const subIssue = createSubIssueData({
      number: 100,
      assignees: ["nopo-bot"],
      labels: ["triaged", "groomed"],
    });

    const parentIssue = createIssue({
      number: 42,
      labels: ["triaged", "groomed"],
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      hasSubIssues: true,
      subIssues: [subIssue],
    });

    const context = createMachineContext({
      trigger: "issue-edited",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        ...subIssue,
        subIssues: [],
        hasSubIssues: false,
        iteration: 0,
        failures: 0,
        comments: [],
        parentIssueNumber: 42,
      }),
      parentIssue: parentIssue,
      currentPhase: 1,
      totalPhases: 1,
      currentSubIssue: subIssue,
    });

    const result = runMachine(context);

    expect(result.state).toBe("iterating");
    expect(result.actionTypes).toContain("createBranch");
    expect(result.actionTypes).toContain("updateProjectStatus");
    expect(result.actionTypes).toContain("incrementIteration");
    expect(result.actionTypes).toContain("appendHistory");
    expect(result.actionTypes).not.toContain("log");
    expect(result.actionTypes).toContain("runClaude");
    expect(result.actionTypes).toContain("applyIterateOutput");
    expect(result.actionTypes).toContain("createPR");

    const branchAction = firstAction(result.actions, "createBranch");
    expect(branchAction).toMatchObject({
      branchName: "claude/issue/100/phase-1",
    });

    const claudeAction = firstAction(result.actions, "runClaude");
    expect(claudeAction).toMatchObject({
      promptDir: "iterate",
      issueNumber: 100,
    });
  });

  it("step 4: CI passes with todos done -> transition to review", () => {
    const subIssue = createSubIssueData({
      number: 100,
      assignees: ["nopo-bot"],
      bodyAst: parseMarkdown(
        "## Todos\n- [x] Install passport.js\n- [x] Configure OAuth\n- [x] Sessions",
      ),
    });

    const parentIssue = createIssue({
      number: 42,
      labels: ["triaged", "groomed"],
      projectStatus: "In progress",
      assignees: ["nopo-bot"],
      hasSubIssues: true,
      subIssues: [subIssue],
    });

    const context = createMachineContext({
      trigger: "workflow-run-completed",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        ...subIssue,
        subIssues: [],
        hasSubIssues: false,
        iteration: 1,
        failures: 0,
        comments: [],
        parentIssueNumber: 42,
        bodyAst: parseMarkdown(
          "## Todos\n- [x] Install passport.js\n- [x] Configure OAuth\n- [x] Sessions",
        ),
      }),
      parentIssue: parentIssue,
      currentPhase: 1,
      totalPhases: 1,
      currentSubIssue: subIssue,
      ciResult: "success",
      ciRunUrl: "https://github.com/acme-corp/platform/actions/runs/12345",
      ciCommitSha: "abc123def456",
      pr: createPR({ isDraft: true }),
      hasPR: true,
      branch: "claude/issue/100/phase-1",
      hasBranch: true,
    });

    const result = runMachine(context);

    expect(result.state).toBe("reviewing");
    expect(result.actionTypes).not.toContain("log");
    expect(result.actionTypes).toContain("markPRReady");
    expect(result.actionTypes).toContain("updateProjectStatus");
    expect(result.actionTypes).toContain("requestReview");
    expect(result.actionTypes).toContain("appendHistory");

    const reviewAction = firstAction(result.actions, "requestReview");
    expect(reviewAction).toMatchObject({
      reviewer: "nopo-reviewer",
    });
  });

  it("step 5: bot reviews PR when review is requested", () => {
    const context = createMachineContext({
      trigger: "pr-review-requested",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        labels: ["triaged", "groomed"],
        projectStatus: "In review",
      }),
      ciResult: "success",
      pr: createPR({
        isDraft: false,
        headRef: "claude/issue/100/phase-1",
      }),
      hasPR: true,
      branch: "claude/issue/100/phase-1",
      hasBranch: true,
    });

    const result = runMachine(context);

    expect(result.state).toBe("prReviewing");
    expect(result.actionTypes).toContain("runClaude");
    expect(result.actionTypes).toContain("applyReviewOutput");

    const claudeAction = firstAction(result.actions, "runClaude");
    expect(claudeAction).toMatchObject({
      promptDir: "review",
    });
  });

  it("step 6: approved review -> merge PR", () => {
    const context = createMachineContext({
      trigger: "pr-review-approved",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        labels: ["triaged", "groomed"],
        projectStatus: "In review",
      }),
      reviewDecision: "APPROVED",
      pr: createPR({ isDraft: false }),
      hasPR: true,
    });

    const result = runMachine(context);

    expect(result.state).toBe("awaitingMerge");
    expect(result.actionTypes).toContain("mergePR");

    const mergeAction = firstAction(result.actions, "mergePR");
    expect(mergeAction).toMatchObject({
      mergeMethod: "squash",
      prNumber: 10,
    });
  });
});

// ============================================================================
// Scenario 2: CI Failure -> Fix -> Retry -> Block -> Recovery
// ============================================================================

describe("scenario: CI failure cascade and recovery", () => {
  const workingSubIssue = createSubIssueData({
    number: 100,
    assignees: ["nopo-bot"],
  });

  const parentIssue = createIssue({
    number: 42,
    labels: ["triaged", "groomed"],
    projectStatus: "In progress",
    assignees: ["nopo-bot"],
    hasSubIssues: true,
    subIssues: [workingSubIssue],
  });

  function ciContext(failures: number, ciResult: "success" | "failure") {
    return createMachineContext({
      trigger: "workflow-run-completed",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        ...workingSubIssue,
        subIssues: [],
        hasSubIssues: false,
        iteration: failures + 1,
        failures,
        comments: [],
        parentIssueNumber: 42,
      }),
      parentIssue: parentIssue,
      currentPhase: 1,
      totalPhases: 1,
      currentSubIssue: workingSubIssue,
      ciResult,
      ciRunUrl: `https://github.com/acme-corp/platform/actions/runs/${1000 + failures}`,
      ciCommitSha: `commit${failures}`,
      pr: createPR(),
      hasPR: true,
      branch: "claude/issue/100/phase-1",
      hasBranch: true,
      maxRetries: 3,
    });
  }

  it("first CI failure (0 failures) -> iteratingFix with recordFailure", () => {
    const result = runMachine(ciContext(0, "failure"));

    expect(result.state).toBe("iteratingFix");
    expect(result.actionTypes).toContain("recordFailure");
    expect(result.actionTypes).not.toContain("log");
    expect(result.actionTypes).toContain("createBranch");
    expect(result.actionTypes).toContain("incrementIteration");
    expect(result.actionTypes).toContain("runClaude");

    const failureAction = firstAction(result.actions, "recordFailure");
    expect(failureAction).toMatchObject({
      issueNumber: 100,
      failureType: "ci",
    });
  });

  it("second CI failure (1 failure) -> iteratingFix again", () => {
    const result = runMachine(ciContext(1, "failure"));

    expect(result.state).toBe("iteratingFix");
    expect(result.actionTypes).toContain("recordFailure");
    expect(result.actionTypes).toContain("runClaude");
  });

  it("third CI failure at max retries (3/3) -> blocked", () => {
    const context = createMachineContext({
      trigger: "workflow-run-completed",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        ...workingSubIssue,
        subIssues: [],
        hasSubIssues: false,
        iteration: 4,
        failures: 3,
        comments: [],
        parentIssueNumber: 42,
      }),
      parentIssue: parentIssue,
      currentPhase: 1,
      totalPhases: 1,
      currentSubIssue: workingSubIssue,
      ciResult: "failure",
      ciRunUrl: "https://github.com/acme-corp/platform/actions/runs/2000",
      ciCommitSha: "commitblocked",
      pr: createPR(),
      hasPR: true,
      branch: "claude/issue/100/phase-1",
      hasBranch: true,
      maxRetries: 3,
    });

    const result = runMachine(context);

    expect(result.state).toBe("blocked");
    expect(result.actionTypes).toContain("updateProjectStatus");
    expect(result.actionTypes).toContain("unassignUser");
    expect(result.actionTypes).toContain("appendHistory");
    expect(result.actionTypes).toContain("block");

    const statusAction = firstAction(result.actions, "updateProjectStatus");
    expect(statusAction).toMatchObject({ status: "Blocked" });

    const unassignAction = firstAction(result.actions, "unassignUser");
    expect(unassignAction).toMatchObject({ username: "nopo-bot" });
  });

  it("retry command on blocked issue -> clears failures and resumes", () => {
    const context = createMachineContext({
      trigger: "issue-retry",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        ...workingSubIssue,
        subIssues: [],
        hasSubIssues: false,
        iteration: 4,
        failures: 3,
        projectStatus: "Blocked",
        comments: [],
        parentIssueNumber: 42,
      }),
      parentIssue: parentIssue,
      currentPhase: 1,
      totalPhases: 1,
      currentSubIssue: workingSubIssue,
    });

    const result = runMachine(context);

    expect(result.state).toBe("iterating");
    expect(result.actionTypes).toContain("clearFailures");
    expect(result.actionTypes).toContain("updateProjectStatus");
    expect(result.actionTypes).toContain("createBranch");
    expect(result.actionTypes).toContain("runClaude");
  });

  it("CI success after fix clears failures and continues", () => {
    const result = runMachine(ciContext(2, "success"));

    expect(result.state).toBe("iterating");
    expect(result.actionTypes).toContain("clearFailures");
    expect(result.actionTypes).not.toContain("log");
  });
});

// ============================================================================
// Scenario 3: Multi-Phase Orchestration
// ============================================================================

describe("scenario: multi-phase orchestration", () => {
  const phase1 = createSubIssueData({
    number: 100,
    title: "[Phase 1]: Setup auth infrastructure",
  });

  const phase2 = createSubIssueData({
    number: 101,
    title: "[Phase 2]: Implement login/logout UI",
  });

  const parentWithPhases = createIssue({
    number: 42,
    labels: ["triaged", "groomed"],
    projectStatus: "In progress",
    assignees: ["nopo-bot"],
    hasSubIssues: true,
    subIssues: [phase1, phase2],
  });

  it("orchestrate trigger -> assigns bot to first phase", () => {
    const context = createMachineContext({
      trigger: "issue-orchestrate",
      owner: "acme-corp",
      repo: "platform",
      issue: parentWithPhases,
      currentPhase: 1,
      totalPhases: 2,
      currentSubIssue: phase1,
    });

    const result = runMachine(context);

    expect(result.state).toBe("orchestrationRunning");
    expect(result.actionTypes).not.toContain("log");
    expect(result.actionTypes).toContain("assignUser");

    const assigns = actionsByType(result.actions, "assignUser");
    const subAssign = assigns.find(
      (a) => "issueNumber" in a && a.issueNumber === 100,
    );
    expect(subAssign).toBeDefined();
    expect(subAssign).toMatchObject({ username: "nopo-bot" });
  });

  it("all phases done -> closes parent issue", () => {
    const donePhase1 = createSubIssueData({
      number: 100,
      state: "CLOSED",
      projectStatus: "Done",
    });
    const donePhase2 = createSubIssueData({
      number: 101,
      state: "CLOSED",
      projectStatus: "Done",
    });

    const context = createMachineContext({
      trigger: "issue-orchestrate",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        ...parentWithPhases,
        subIssues: [donePhase1, donePhase2],
      }),
      currentPhase: 2,
      totalPhases: 2,
      currentSubIssue: donePhase2,
    });

    const result = runMachine(context);

    expect(result.state).toBe("orchestrationComplete");
    expect(result.actionTypes).toContain("updateProjectStatus");
    expect(result.actionTypes).toContain("closeIssue");
    expect(result.actionTypes).toContain("appendHistory");

    const statusActions = actionsByType(result.actions, "updateProjectStatus");
    const doneStatus = statusActions.find(
      (a) => "status" in a && a.status === "Done",
    );
    expect(doneStatus).toBeDefined();
  });

  it("PR merged on sub-issue -> orchestrates next phase", () => {
    const context = createMachineContext({
      trigger: "pr-merged",
      owner: "acme-corp",
      repo: "platform",
      issue: parentWithPhases,
      currentPhase: 1,
      totalPhases: 2,
      currentSubIssue: phase1,
    });

    const result = runMachine(context);

    expect(result.state).toBe("orchestrationRunning");
    expect(result.actionTypes).toContain("appendHistory");
    expect(result.actionTypes).toContain("updateProjectStatus");
    expect(result.actionTypes).toContain("closeIssue");
    expect(result.actionTypes).not.toContain("log");
    expect(result.actionTypes).toContain("assignUser");
  });

  it("orchestrating with phase in review -> waits", () => {
    const reviewPhase = createSubIssueData({
      number: 100,
      projectStatus: "In review",
    });

    const context = createMachineContext({
      trigger: "issue-orchestrate",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        ...parentWithPhases,
        subIssues: [reviewPhase, phase2],
      }),
      currentPhase: 1,
      totalPhases: 2,
      currentSubIssue: reviewPhase,
    });

    const result = runMachine(context);

    expect(result.state).toBe("orchestrationWaiting");
    expect(result.actionTypes).not.toContain("log");
  });
});

// ============================================================================
// Scenario 4: PR Review Response Flows
// ============================================================================

describe("scenario: PR review interactions", () => {
  it("bot responds to bot review with review-response prompt", () => {
    const reviewContext = createMachineContext({
      trigger: "pr-response",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        labels: ["triaged", "groomed"],
        projectStatus: "In review",
      }),
      pr: createPR({
        isDraft: false,
        headRef: "claude/issue/42",
        reviews: [
          {
            state: "CHANGES_REQUESTED",
            author: "nopo-reviewer",
            body: "Please fix the error handling in auth.ts",
          },
        ],
      }),
      hasPR: true,
      reviewDecision: "CHANGES_REQUESTED",
      reviewerId: "nopo-reviewer",
    });

    const result = runMachine(reviewContext);

    expect(result.state).toBe("prResponding");
    expect(result.actionTypes).toContain("runClaude");
    expect(result.actionTypes).toContain("applyPRResponseOutput");

    const claudeAction = firstAction(result.actions, "runClaude");
    expect(claudeAction).toMatchObject({
      promptDir: "review-response",
    });
  });

  it("bot responds to human review with human-review-response prompt", () => {
    const humanReviewCtx = createMachineContext({
      trigger: "pr-human-response",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        labels: ["triaged", "groomed"],
        projectStatus: "In review",
      }),
      pr: createPR({
        isDraft: false,
        reviews: [
          {
            state: "CHANGES_REQUESTED",
            author: "human-dev",
            body: "The API response format is wrong",
          },
        ],
      }),
      hasPR: true,
      reviewDecision: "CHANGES_REQUESTED",
      reviewerId: "human-dev",
    });

    const result = runMachine(humanReviewCtx);

    expect(result.state).toBe("prRespondingHuman");

    const claudeAction = firstAction(result.actions, "runClaude");
    expect(claudeAction).toMatchObject({
      promptDir: "human-review-response",
    });

    const applyAction = firstAction(result.actions, "applyPRResponseOutput");
    expect(applyAction).toMatchObject({
      reviewer: "human-dev",
    });
  });

  it("changes requested on review -> back to iterating with draft conversion", () => {
    const context = createMachineContext({
      trigger: "pr-review-submitted",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        number: 100,
        labels: ["triaged", "groomed"],
        projectStatus: "In review",
        assignees: ["nopo-bot"],
        parentIssueNumber: 42,
      }),
      parentIssue: createIssue({
        number: 42,
        assignees: ["nopo-bot"],
        labels: ["triaged", "groomed"],
        hasSubIssues: true,
      }),
      reviewDecision: "CHANGES_REQUESTED",
      pr: createPR({ isDraft: false }),
      hasPR: true,
    });

    const result = runMachine(context);

    expect(result.state).toBe("iterating");
    expect(result.actionTypes).toContain("convertPRToDraft");
    expect(result.actionTypes).toContain("runClaude");
  });

  it("push to ready PR -> converts to draft and logs", () => {
    const context = createMachineContext({
      trigger: "pr-push",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        labels: ["triaged", "groomed"],
        projectStatus: "In review",
      }),
      pr: createPR({ isDraft: false }),
      hasPR: true,
      ciCommitSha: "newcommitabc",
    });

    const result = runMachine(context);

    expect(result.state).toBe("prPush");
    expect(result.actionTypes).toContain("convertPRToDraft");
    expect(result.actionTypes).toContain("removeReviewer");
    expect(result.actionTypes).toContain("appendHistory");
    expect(result.actionTypes).toContain("updateProjectStatus");
  });
});

// ============================================================================
// Scenario 5: Reset and Pivot Commands
// ============================================================================

describe("scenario: operator commands", () => {
  it("reset command clears all state and sub-issue fields", () => {
    const phase1 = createSubIssueData({
      number: 100,
      projectStatus: "In progress",
    });
    const phase2 = createSubIssueData({
      number: 101,
      projectStatus: "Done",
      state: "CLOSED",
    });

    const context = createMachineContext({
      trigger: "issue-reset",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        labels: ["triaged", "groomed"],
        projectStatus: "In progress",
        iteration: 5,
        failures: 2,
        hasSubIssues: true,
        subIssues: [phase1, phase2],
      }),
    });

    const result = runMachine(context);

    expect(result.state).toBe("resetting");
    expect(result.actionTypes).toContain("resetIssue");
    expect(result.actionTypes).toContain("updateProjectStatus");
    expect(result.actionTypes).toContain("clearFailures");
    expect(result.actionTypes).toContain("removeFromProject");

    const statusActions = actionsByType(result.actions, "updateProjectStatus");
    const backlogStatus = statusActions.find(
      (a) => "status" in a && a.status === "Backlog",
    );
    expect(backlogStatus).toBeDefined();

    const removeActions = actionsByType(result.actions, "removeFromProject");
    expect(removeActions.length).toBe(2);
  });

  it("pivot command triggers pivot analysis", () => {
    const context = createMachineContext({
      trigger: "issue-pivot",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        labels: ["triaged", "groomed"],
        projectStatus: "In progress",
        hasSubIssues: true,
        subIssues: [
          createSubIssueData({ number: 100, projectStatus: "In progress" }),
        ],
      }),
      pivotDescription:
        "Requirements changed: use SAML instead of OAuth. Need to restructure phases.",
    });

    const result = runMachine(context);

    expect(result.state).toBe("pivoting");
    expect(result.actionTypes).toContain("appendHistory");
    expect(result.actionTypes).toContain("runClaude");
    expect(result.actionTypes).toContain("applyPivotOutput");

    const claudeAction = firstAction(result.actions, "runClaude");
    expect(claudeAction).toMatchObject({
      promptDir: "pivot",
    });
  });
});

// ============================================================================
// Scenario 6: Terminal State Guards
// ============================================================================

describe("scenario: terminal state handling", () => {
  it("already done issue produces no work actions", () => {
    const context = createMachineContext({
      trigger: "issue-edited",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        projectStatus: "Done",
        state: "OPEN",
        labels: ["triaged", "groomed"],
      }),
      pr: createPR({ state: "MERGED", isDraft: false }),
      hasPR: true,
    });

    const result = runMachine(context);

    expect(result.state).toBe("done");
    expect(result.actionTypes).not.toContain("runClaude");
    expect(result.actionTypes).not.toContain("incrementIteration");
    expect(result.actionTypes).toContain("updateProjectStatus");
    expect(result.actionTypes).toContain("closeIssue");
  });

  it("blocked issue stays blocked unless retry command", () => {
    const context = createMachineContext({
      trigger: "issue-edited",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        projectStatus: "Blocked",
        labels: ["triaged", "groomed"],
        failures: 5,
      }),
    });

    const result = runMachine(context);

    expect(result.state).toBe("alreadyBlocked");
    expect(result.actionTypes).not.toContain("runClaude");
    expect(result.actionTypes).not.toContain("incrementIteration");
    expect(result.actionTypes).not.toContain("log");
  });

  it("error issue stays in error", () => {
    const context = createMachineContext({
      trigger: "issue-edited",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        projectStatus: "Error",
        labels: ["triaged", "groomed"],
      }),
    });

    const result = runMachine(context);

    expect(result.state).toBe("error");
    expect(result.actionTypes).not.toContain("runClaude");
    expect(result.actionTypes).not.toContain("log");
  });
});

// ============================================================================
// Scenario 7: Comment Response
// ============================================================================

describe("scenario: @claude comment handling", () => {
  it("responds to @claude mention with comment prompt", () => {
    const context = createMachineContext({
      trigger: "issue-comment",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        labels: ["triaged", "groomed"],
        projectStatus: "In progress",
        comments: [
          createComment({
            author: "developer-alice",
            body: "@claude Can you explain the auth flow?",
            createdAt: "2026-02-14T10:00:00Z",
          }),
        ],
      }),
      commentContextType: "issue",
      commentContextDescription: "This is issue #42.",
    });

    const result = runMachine(context);

    expect(result.state).toBe("commenting");
    expect(result.actionTypes).toContain("runClaude");

    const claudeAction = firstAction(result.actions, "runClaude");
    expect(claudeAction).toMatchObject({
      promptDir: "comment",
    });
  });
});

// ============================================================================
// Scenario 8: Merge Queue and Deployment Logging
// ============================================================================

describe("scenario: merge queue and deployment events", () => {
  const baseIssue = createIssue({
    labels: ["triaged", "groomed"],
    projectStatus: "In progress",
  });

  it("merge queue entry logs history", () => {
    const result = runMachine(
      createMachineContext({
        trigger: "merge-queue-entered",
        owner: "acme-corp",
        repo: "platform",
        issue: baseIssue,
      }),
    );

    expect(result.state).toBe("mergeQueueLogging");
    expect(result.actionTypes).toContain("appendHistory");
  });

  it("merge queue failure logs history", () => {
    const result = runMachine(
      createMachineContext({
        trigger: "merge-queue-failed",
        owner: "acme-corp",
        repo: "platform",
        issue: baseIssue,
      }),
    );

    expect(result.state).toBe("mergeQueueFailureLogging");
    expect(result.actionTypes).toContain("appendHistory");
  });

  it("stage deployment logs history", () => {
    const result = runMachine(
      createMachineContext({
        trigger: "deployed-stage",
        owner: "acme-corp",
        repo: "platform",
        issue: baseIssue,
        ciCommitSha: "deploy123",
      }),
    );

    expect(result.state).toBe("deployedStageLogging");
    expect(result.actionTypes).toContain("appendHistory");
  });

  it("prod deployment logs history", () => {
    const result = runMachine(
      createMachineContext({
        trigger: "deployed-prod",
        owner: "acme-corp",
        repo: "platform",
        issue: baseIssue,
        ciCommitSha: "release456",
      }),
    );

    expect(result.state).toBe("deployedProdLogging");
    expect(result.actionTypes).toContain("appendHistory");
  });

  it("stage deployment failure logs history", () => {
    const result = runMachine(
      createMachineContext({
        trigger: "deployed-stage-failed",
        owner: "acme-corp",
        repo: "platform",
        issue: baseIssue,
      }),
    );

    expect(result.state).toBe("deployedStageFailureLogging");
    expect(result.actionTypes).toContain("appendHistory");
  });

  it("prod deployment failure logs history", () => {
    const result = runMachine(
      createMachineContext({
        trigger: "deployed-prod-failed",
        owner: "acme-corp",
        repo: "platform",
        issue: baseIssue,
      }),
    );

    expect(result.state).toBe("deployedProdFailureLogging");
    expect(result.actionTypes).toContain("appendHistory");
  });
});

// ============================================================================
// Scenario 9: Invalid States and Edge Cases
// ============================================================================

describe("scenario: edge cases", () => {
  it("parent issue without sub-issues -> invalidIteration with error", () => {
    const context = createMachineContext({
      trigger: "issue-edited",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        labels: ["triaged", "groomed"],
        projectStatus: "In progress",
        assignees: ["nopo-bot"],
      }),
    });

    const result = runMachine(context);

    expect(result.state).toBe("invalidIteration");
    expect(result.actionTypes).toContain("appendHistory");
    expect(result.actionTypes).toContain("addComment");
    expect(result.actionTypes).toContain("updateProjectStatus");

    const statusAction = firstAction(result.actions, "updateProjectStatus");
    expect(statusAction).toMatchObject({ status: "Error" });

    const commentAction = firstAction(result.actions, "addComment");
    expect(
      "body" in commentAction &&
        typeof commentAction.body === "string" &&
        commentAction.body.includes("Invalid Iteration"),
    ).toBe(true);
  });

  it("sub-issue without bot assigned -> idle skip", () => {
    const context = createMachineContext({
      trigger: "issue-edited",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        number: 100,
        title: "[Phase 1]: Setup",
        labels: ["triaged", "groomed"],
        assignees: [],
        parentIssueNumber: 42,
      }),
      parentIssue: createIssue({
        number: 42,
        assignees: ["nopo-bot"],
        labels: ["triaged", "groomed"],
        hasSubIssues: true,
      }),
    });

    const result = runMachine(context);

    expect(result.state).toBe("subIssueIdle");
    expect(result.actionTypes).not.toContain("log");
    expect(result.actionTypes).not.toContain("runClaude");
    expect(result.actionTypes).not.toContain("incrementIteration");
  });

  it("PR review skipped when CI failed", () => {
    const context = createMachineContext({
      trigger: "pr-review-requested",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        labels: ["triaged", "groomed"],
      }),
      ciResult: "failure",
      pr: createPR({ isDraft: false }),
      hasPR: true,
    });

    const result = runMachine(context);

    expect(result.state).toBe("prReviewSkipped");
    expect(result.actionTypes).not.toContain("runClaude");
    expect(result.actionTypes).not.toContain("log");
  });

  it("PR review assigned (ack) when CI status unknown", () => {
    const context = createMachineContext({
      trigger: "pr-review-requested",
      owner: "acme-corp",
      repo: "platform",
      issue: createIssue({
        labels: ["triaged", "groomed"],
      }),
      ciResult: null,
      pr: createPR({ isDraft: false }),
      hasPR: true,
    });

    const result = runMachine(context);

    expect(result.state).toBe("prReviewAssigned");
    expect(result.actionTypes).not.toContain("runClaude");
    expect(result.actionTypes).not.toContain("log");
  });
});

// ============================================================================
// Scenario: Verification Predictions
// Tests that MachineVerifier predictions match actual post-execution state.
// These prevent failed verifications in production.
// ============================================================================

describe("scenario: verification predictions", () => {
  it("triage prediction reflects body rewrite (Requirements/Approach, not Description/AcceptanceCriteria)", () => {
    // Issue with Description and Acceptance Criteria (like user-created issues)
    const context = createContext({
      trigger: "issue-triage",
      issue: createIssue({
        labels: [],
        projectStatus: "Backlog",
        // @ts-expect-error -- mdast Root type mismatch
        bodyAst: parseMarkdown(
          [
            "## Description",
            "Some description text.",
            "",
            "## Acceptance Criteria",
            "- [ ] Criterion one",
            "- [ ] Criterion two",
          ].join("\n"),
        ),
      }),
    });

    const machine = new IssueMachine(context, { logger: createMockLogger() });
    const result = machine.predict();
    expect(result.state).toBe("triaging");

    // Extract current tree and run predictions
    const currentTree = extractPredictableTree(context);
    const outcomes = predictFromActions(
      result.actions,
      currentTree,
      context,
      { finalState: result.state },
    );

    expect(outcomes.length).toBeGreaterThan(0);

    // Every outcome should reflect triage body rewrite
    for (const outcome of outcomes) {
      // After triage, Description and AcceptanceCriteria are replaced
      expect(outcome.issue.body.hasDescription).toBe(false);
      expect(outcome.issue.body.hasAcceptanceCriteria).toBe(false);
      // Requirements and Approach are created by triage
      expect(outcome.issue.body.hasRequirements).toBe(true);
      expect(outcome.issue.body.hasApproach).toBe(true);
      // triaged label added
      expect(outcome.issue.labels).toContain("triaged");
    }
  });

  it("triage prediction works via MachineVerifier", () => {
    const context = createContext({
      trigger: "issue-triage",
      issue: createIssue({
        labels: [],
        projectStatus: "Backlog",
      }),
    });

    const machine = new IssueMachine(context, { logger: createMockLogger() });
    const result = machine.predict();

    const verifier = new MachineVerifier();
    const expected = verifier.predictExpectedState(result, context);

    expect(expected.finalState).toBe("triaging");
    expect(expected.expectedRetrigger).toBe(true);
    expect(expected.outcomes.length).toBeGreaterThan(0);

    // Body flags should reflect triage rewrite
    for (const outcome of expected.outcomes) {
      expect(outcome.issue.body.hasDescription).toBe(false);
      expect(outcome.issue.body.hasAcceptanceCriteria).toBe(false);
      expect(outcome.issue.body.hasRequirements).toBe(true);
      expect(outcome.issue.body.hasApproach).toBe(true);
    }
  });

  it("grooming prediction includes triaged+groomed labels", () => {
    const context = createContext({
      trigger: "issue-groom",
      issue: createIssue({
        labels: ["triaged", "enhancement", "P1"],
        projectStatus: "Backlog",
      }),
    });

    const machine = new IssueMachine(context, { logger: createMockLogger() });
    const result = machine.predict();
    expect(result.state).toBe("grooming");

    const verifier = new MachineVerifier();
    const expected = verifier.predictExpectedState(result, context);

    expect(expected.finalState).toBe("grooming");
    expect(expected.expectedRetrigger).toBe(false);
  });

  it("grooming prediction does not include transient ⏳ placeholder history entries", () => {
    // The grooming machine emits appendHistory with "⏳ grooming..." placeholder.
    // These get replaced by logRunEnd before verification runs, so the prediction
    // should skip them (predict empty diff for ⏳ entries).
    const context = createContext({
      trigger: "issue-groom",
      issue: createIssue({
        labels: ["triaged", "enhancement", "P1"],
        projectStatus: "Backlog",
      }),
    });

    const machine = new IssueMachine(context, { logger: createMockLogger() });
    const result = machine.predict();
    expect(result.state).toBe("grooming");

    const currentTree = extractPredictableTree(context);
    const outcomes = predictFromActions(
      result.actions,
      currentTree,
      context,
      { finalState: result.state },
    );

    expect(outcomes.length).toBeGreaterThan(0);

    // No outcome should have a ⏳ history entry — those are transient placeholders
    for (const outcome of outcomes) {
      const historyActions = outcome.issue.body.historyEntries.map(
        (e) => e.action,
      );
      const hasPlaceholder = historyActions.some((a) => a.startsWith("\u23f3"));
      expect(hasPlaceholder).toBe(false);

      // Should have the success entry (✅ Grooming)
      const hasSuccess = historyActions.some((a) => a.startsWith("\u2705"));
      expect(hasSuccess).toBe(true);
    }
  });

  it("triage prediction on issue without Description section", () => {
    // Issue with no standard sections (bare body text)
    const context = createContext({
      trigger: "issue-triage",
      issue: createIssue({
        labels: [],
        projectStatus: "Backlog",
        // @ts-expect-error -- mdast Root type mismatch
        bodyAst: parseMarkdown("Just some plain text about a bug.\n"),
      }),
    });

    const machine = new IssueMachine(context, { logger: createMockLogger() });
    const result = machine.predict();
    expect(result.state).toBe("triaging");

    const currentTree = extractPredictableTree(context);
    const outcomes = predictFromActions(
      result.actions,
      currentTree,
      context,
      { finalState: result.state },
    );

    // After triage, body should have Requirements/Approach regardless of input
    for (const outcome of outcomes) {
      expect(outcome.issue.body.hasDescription).toBe(false);
      expect(outcome.issue.body.hasRequirements).toBe(true);
      expect(outcome.issue.body.hasApproach).toBe(true);
    }
  });
});
