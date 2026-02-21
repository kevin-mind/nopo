import {
  createMockFactory,
  type DeepOmitOptional,
  type MockFactory,
} from "@more/mock-factory";
import type {
  ExampleContext,
  ExampleIssue,
  ExamplePR,
} from "../../src/machines/example/context.js";
import type { IssueData, LinkedPR, SubIssueData } from "@more/issue-state";
import type { ExampleNormalizedEvent } from "../../src/machines/example/events.js";
import type { ExampleServices } from "../../src/machines/example/services.js";

export const mockExampleIssue = createMockFactory<ExampleIssue>({
  number: 42,
  title: "Test Issue",
  body: "",
  comments: [],
  state: "OPEN",
  projectStatus: null,
  labels: [],
  assignees: [],
  hasSubIssues: false,
  subIssues: [],
  iteration: 0,
  failures: 0,
});

type ExamplePRFixture = Omit<ExamplePR, "reviews"> & {
  reviews: Array<Record<string, unknown>>;
};

const buildExamplePR = createMockFactory<ExamplePRFixture>({
  number: 1,
  state: "OPEN",
  isDraft: false,
  title: "Test PR",
  headRef: "feature",
  baseRef: "main",
  labels: [],
  reviews: [],
});

type ExampleContextFixture = Omit<ExampleContext, "pr"> & {
  pr: ExamplePRFixture | null;
};

const buildExampleContext = createMockFactory<ExampleContextFixture>({
  trigger: "issue-triage",
  owner: "test-owner",
  repo: "test-repo",
  issue: mockExampleIssue(),
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
  reviewerUsername: "nopo-reviewer",
});

export const mockExamplePR = buildExamplePR;
export const mockExampleContext = (
  overrides?: Parameters<typeof buildExampleContext>[0],
): ExampleContext => {
  const ctx = buildExampleContext(overrides);
  // When parentIssue is set and currentSubIssue wasn't explicitly provided,
  // auto-derive currentSubIssue from issue (the sub-issue itself).
  if (ctx.parentIssue !== null && ctx.currentSubIssue === null) {
    ctx.currentSubIssue = ctx.issue;
  }
  return ctx;
};

export const mockIssueStateLinkedPR = createMockFactory<LinkedPR>({
  number: 10,
  title: "PR",
  state: "OPEN",
  isDraft: false,
  headRef: "feature/branch",
  baseRef: "main",
  labels: [],
  reviews: [],
});

// Inline empty root avoids importing from @more/issue-state (breaks when tests mock it)
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Zod-inferred bodyAst type is narrower than mdast Root; assertion bridges the gap
const emptyBodyAst = {
  type: "root" as const,
  children: [],
} as SubIssueData["bodyAst"];

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Zod-inferred bodyAst type is narrower than mdast Root; assertion bridges the gap
const subIssueDefaults = {
  number: 100,
  title: "Sub-issue",
  state: "OPEN",
  bodyAst: emptyBodyAst,
  projectStatus: null,
  assignees: [],
  labels: [],
  branch: null,
  pr: null,
} as DeepOmitOptional<SubIssueData>;

export const mockIssueStateSubIssueData: MockFactory<SubIssueData> =
  createMockFactory<SubIssueData>(subIssueDefaults);

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Zod-inferred bodyAst type is narrower than mdast Root; assertion bridges the gap
const issueDefaults = {
  number: 42,
  title: "Issue",
  state: "OPEN",
  bodyAst: emptyBodyAst,
  projectStatus: "In progress",
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
} as DeepOmitOptional<IssueData>;

export const mockIssueStateIssueData: MockFactory<IssueData> =
  createMockFactory<IssueData>(issueDefaults);

export const mockExampleServices = createMockFactory<ExampleServices>({
  triage: {
    triageIssue: async () => ({
      labelsToAdd: ["type:enhancement"],
      summary: "Issue triaged",
    }),
  },
  grooming: {
    groomIssue: async () => ({
      labelsToAdd: [],
      decision: "ready" as const,
      summary: "Issue groomed",
      recommendedPhases: [
        {
          phase_number: 1,
          title: "Implementation",
          description: "Implement the feature",
        },
      ],
    }),
  },
  iteration: {
    iterateIssue: async () => ({
      labelsToAdd: [],
      summary: "Iteration plan ready",
    }),
  },
  review: {
    reviewIssue: async () => ({
      labelsToAdd: [],
      summary: "Review analyzed",
    }),
  },
  prResponse: {
    respondToPr: async () => ({
      labelsToAdd: [],
      summary: "Response prepared",
    }),
  },
});

export const mockExampleNormalizedEvent =
  createMockFactory<ExampleNormalizedEvent>({
    type: "issue_assigned",
    owner: "owner",
    repo: "repo",
    issueNumber: 42,
    timestamp: "2026-01-01T00:00:00.000Z",
  });
