/**
 * Test fixtures for state machine tests
 *
 * These factories create validated objects using the zod schemas,
 * ensuring test data matches the actual schema constraints.
 */
import { createMachineContext } from "../../schemas/index.js";
import type {
  MachineContext,
  ParentIssue,
  SubIssue,
  LinkedPR,
  TodoStats,
  HistoryEntry,
  TriggerType,
  ProjectStatus,
  CIResult,
  ReviewDecision,
} from "../../schemas/index.js";

// ============================================================================
// Override Types - Allow partial nested objects in test fixtures
// ============================================================================

/**
 * ParentIssue override type that allows partial sub-issues
 */
type ParentIssueOverride = Omit<Partial<ParentIssue>, "subIssues"> & {
  subIssues?: Array<Partial<SubIssue>>;
};

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_TODO_STATS: TodoStats = {
  total: 0,
  completed: 0,
  uncheckedNonManual: 0,
};

export const DEFAULT_SUB_ISSUE: SubIssue = {
  number: 1,
  title: "Test Sub-Issue",
  state: "OPEN",
  body: "",
  projectStatus: "In progress",
  branch: null,
  pr: null,
  todos: DEFAULT_TODO_STATS,
};

export const DEFAULT_PARENT_ISSUE: ParentIssue = {
  number: 1,
  title: "Test Issue",
  state: "OPEN",
  body: "Test body",
  projectStatus: "In progress",
  iteration: 0,
  failures: 0,
  assignees: ["nopo-bot"],
  labels: ["triaged", "groomed"], // Both labels to bypass grooming and proceed to iteration
  subIssues: [],
  hasSubIssues: false,
  history: [],
  comments: [],
  todos: DEFAULT_TODO_STATS,
};

export const DEFAULT_PR: LinkedPR = {
  number: 1,
  state: "OPEN",
  isDraft: true,
  title: "Test PR",
  headRef: "feature",
  baseRef: "main",
};

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a valid TodoStats object
 */
export function createTodoStats(overrides: Partial<TodoStats> = {}): TodoStats {
  return {
    ...DEFAULT_TODO_STATS,
    ...overrides,
  };
}

/**
 * Create a valid LinkedPR object
 */
export function createLinkedPR(overrides: Partial<LinkedPR> = {}): LinkedPR {
  return {
    ...DEFAULT_PR,
    ...overrides,
  };
}

/**
 * Create a valid SubIssue object
 */
export function createSubIssue(
  overrides: Partial<SubIssue> & { number?: number } = {},
): SubIssue {
  return {
    ...DEFAULT_SUB_ISSUE,
    ...overrides,
    todos: {
      ...DEFAULT_TODO_STATS,
      ...(overrides.todos || {}),
    },
  };
}

/**
 * Create a valid ParentIssue object
 */
export function createParentIssue(
  overrides: ParentIssueOverride & {
    number?: number;
    todos?: Partial<TodoStats>;
  } = {},
): ParentIssue {
  const subIssues =
    overrides.subIssues?.map((s, i) =>
      typeof s === "object" ? createSubIssue({ number: i + 1, ...s }) : s,
    ) || [];

  // Derive hasSubIssues from subIssues array unless explicitly provided
  const hasSubIssues =
    overrides.hasSubIssues !== undefined
      ? overrides.hasSubIssues
      : subIssues.length > 0;

  return {
    ...DEFAULT_PARENT_ISSUE,
    ...overrides,
    subIssues,
    hasSubIssues,
    todos: {
      ...DEFAULT_TODO_STATS,
      ...(overrides.todos || {}),
    },
  };
}

/**
 * Create a valid HistoryEntry object
 */
export function createHistoryEntry(
  overrides: Partial<HistoryEntry> = {},
): HistoryEntry {
  return {
    iteration: 1,
    phase: "1",
    action: "Test action",
    timestamp: null,
    sha: null,
    runLink: null,
    ...overrides,
  };
}

/**
 * Create a valid MachineContext using zod validation
 *
 * This ensures all test contexts pass schema validation.
 */
export function createContext(
  overrides: {
    trigger?: TriggerType;
    owner?: string;
    repo?: string;
    issue?: ParentIssueOverride;
    parentIssue?: ParentIssueOverride | null;
    currentPhase?: number | null;
    totalPhases?: number;
    currentSubIssue?: Partial<SubIssue> | null;
    ciResult?: CIResult | null;
    ciRunUrl?: string | null;
    ciCommitSha?: string | null;
    workflowStartedAt?: string | null;
    reviewDecision?: ReviewDecision | null;
    reviewerId?: string | null;
    branch?: string | null;
    hasBranch?: boolean;
    pr?: Partial<LinkedPR> | null;
    hasPR?: boolean;
    commentContextType?: "issue" | "pr" | null;
    commentContextDescription?: string | null;
    maxRetries?: number;
    botUsername?: string;
  } = {},
): MachineContext {
  // Build the issue with proper defaults
  const issue = createParentIssue(overrides.issue);

  // Build currentSubIssue if provided
  const currentSubIssue = overrides.currentSubIssue
    ? createSubIssue(overrides.currentSubIssue)
    : null;

  // Build PR if provided
  const pr = overrides.pr ? createLinkedPR(overrides.pr) : null;

  // Build parent issue if provided
  const parentIssue = overrides.parentIssue
    ? createParentIssue(overrides.parentIssue)
    : null;

  // Use the schema's createMachineContext for validation
  return createMachineContext({
    trigger: overrides.trigger ?? "issue-assigned",
    owner: overrides.owner ?? "test-owner",
    repo: overrides.repo ?? "test-repo",
    issue,
    parentIssue,
    currentPhase: overrides.currentPhase ?? null,
    totalPhases: overrides.totalPhases ?? issue.subIssues.length,
    currentSubIssue,
    ciResult: overrides.ciResult ?? null,
    ciRunUrl: overrides.ciRunUrl ?? null,
    ciCommitSha: overrides.ciCommitSha ?? null,
    workflowStartedAt: overrides.workflowStartedAt ?? null,
    reviewDecision: overrides.reviewDecision ?? null,
    reviewerId: overrides.reviewerId ?? null,
    branch: overrides.branch ?? null,
    hasBranch: overrides.hasBranch ?? false,
    pr,
    hasPR: overrides.hasPR ?? pr !== null,
    commentContextType: overrides.commentContextType ?? null,
    commentContextDescription: overrides.commentContextDescription ?? null,
    maxRetries: overrides.maxRetries ?? 5,
    botUsername: overrides.botUsername ?? "nopo-bot",
  });
}

// ============================================================================
// Scenario Fixtures
// ============================================================================

/**
 * Context for a new issue that was just assigned
 */
export function createNewIssueContext(
  overrides: Parameters<typeof createContext>[0] = {},
): MachineContext {
  return createContext({
    trigger: "issue-assigned",
    issue: { projectStatus: "In progress" },
    ...overrides,
  });
}

/**
 * Context for CI success
 */
export function createCISuccessContext(
  overrides: Parameters<typeof createContext>[0] = {},
): MachineContext {
  return createContext({
    trigger: "workflow-run-completed",
    ciResult: "success",
    issue: { projectStatus: "In progress" },
    ...overrides,
  });
}

/**
 * Context for CI failure
 */
export function createCIFailureContext(
  overrides: Parameters<typeof createContext>[0] = {},
): MachineContext {
  return createContext({
    trigger: "workflow-run-completed",
    ciResult: "failure",
    issue: { projectStatus: "In progress" },
    ...overrides,
  });
}

/**
 * Context for PR review submitted
 */
export function createReviewContext(
  decision: ReviewDecision,
  overrides: Parameters<typeof createContext>[0] = {},
): MachineContext {
  return createContext({
    trigger: "pr-review-submitted",
    reviewDecision: decision,
    issue: { projectStatus: "In review" },
    ...overrides,
  });
}

/**
 * Context with a multi-phase issue
 */
export function createMultiPhaseContext(
  phases: Array<Partial<SubIssue>>,
  overrides: Parameters<typeof createContext>[0] = {},
): MachineContext {
  const subIssues = phases.map((p, i) => ({
    number: i + 1,
    title: `Phase ${i + 1}`,
    state: "OPEN" as const,
    body: "",
    projectStatus: "Ready" as ProjectStatus,
    branch: null,
    pr: null,
    todos: DEFAULT_TODO_STATS,
    ...p,
  }));

  // Find current phase (first non-Done sub-issue)
  const currentPhaseIndex = subIssues.findIndex(
    (s) => s.projectStatus !== "Done" && s.state !== "CLOSED",
  );
  const currentSubIssue =
    currentPhaseIndex >= 0 ? subIssues[currentPhaseIndex] : null;

  return createContext({
    issue: {
      projectStatus: "In progress",
      subIssues,
    },
    currentPhase: currentPhaseIndex >= 0 ? currentPhaseIndex + 1 : null,
    totalPhases: subIssues.length,
    currentSubIssue,
    ...overrides,
  });
}

/**
 * Context with todos to track progress
 */
export function createTodosContext(
  total: number,
  completed: number,
  overrides: Parameters<typeof createContext>[0] = {},
): MachineContext {
  return createContext({
    currentSubIssue: {
      todos: {
        total,
        completed,
        uncheckedNonManual: total - completed,
      },
    },
    ...overrides,
  });
}

/**
 * Context at the circuit breaker limit
 */
export function createMaxFailuresContext(
  overrides: Parameters<typeof createContext>[0] = {},
): MachineContext {
  const maxRetries = overrides.maxRetries ?? 5;
  return createContext({
    issue: { failures: maxRetries },
    maxRetries,
    ...overrides,
  });
}

// ============================================================================
// Discussion Fixtures
// ============================================================================

/**
 * Default discussion context
 */
export const DEFAULT_DISCUSSION = {
  number: 1,
  nodeId: "D_kwDOTest123",
  title: "Test Discussion",
  body: "Test discussion body",
  commentCount: 0,
  researchThreads: [],
};

/**
 * Create a context for discussion triggers
 */
export function createDiscussionContext(
  overrides: Parameters<typeof createContext>[0] & {
    discussion?: Partial<typeof DEFAULT_DISCUSSION> & {
      command?: "summarize" | "plan" | "complete";
      commentId?: string;
      commentBody?: string;
      commentAuthor?: string;
    };
  } = {},
): MachineContext {
  const discussion = {
    ...DEFAULT_DISCUSSION,
    ...overrides.discussion,
  };

  return createMachineContext({
    trigger: overrides.trigger ?? "discussion-created",
    owner: overrides.owner ?? "test-owner",
    repo: overrides.repo ?? "test-repo",
    issue: createParentIssue(overrides.issue),
    discussion,
    maxRetries: overrides.maxRetries ?? 5,
    botUsername: overrides.botUsername ?? "nopo-bot",
  });
}

/**
 * Create a context for new discussion creation
 */
function createNewDiscussionContext(
  overrides: Parameters<typeof createDiscussionContext>[0] = {},
): MachineContext {
  return createDiscussionContext({
    trigger: "discussion-created",
    ...overrides,
  });
}

/**
 * Create a context for discussion comment from human
 */
function createDiscussionCommentContext(
  overrides: Parameters<typeof createDiscussionContext>[0] = {},
): MachineContext {
  return createDiscussionContext({
    trigger: "discussion-comment",
    discussion: {
      commentId: "DC_kwDOTest456",
      commentBody: "I have a question about this",
      commentAuthor: "human-user",
      ...overrides.discussion,
    },
    ...overrides,
  });
}

/**
 * Create a context for discussion command
 */
function createDiscussionCommandContext(
  command: "summarize" | "plan" | "complete",
  overrides: Parameters<typeof createDiscussionContext>[0] = {},
): MachineContext {
  return createDiscussionContext({
    trigger: "discussion-command",
    discussion: {
      command,
      commentId: "DC_kwDOTest789",
      commentBody: `/${command}`,
      commentAuthor: "human-user",
      ...overrides.discussion,
    },
    ...overrides,
  });
}
