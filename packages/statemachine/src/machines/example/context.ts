/**
 * Example machine context — domain state and refresh.
 *
 * Self-contained: no imports from machines/issues or machines/discussions.
 * Used by the example PEV machine for routing, guards, and action execution.
 */

import type { ExternalRunnerContext } from "../../core/pev/types.js";
import type {
  ExampleCIResult,
  ExampleNormalizedEvent,
  ExampleReviewDecision,
  ExampleTrigger,
} from "./events.js";
import type {
  ExampleGroomingOutput,
  ExampleIterationOutput,
  ExamplePrResponseOutput,
  ExampleReviewOutput,
  ExampleTriageOutput,
} from "./services.js";
import {
  addSubIssueToParent,
  createExtractor,
  createMutator,
  GET_PR_ID_QUERY,
  MARK_PR_READY_MUTATION,
  parseIssue,
  parseMarkdown,
  serializeMarkdown,
  updateProjectFields,
  type IssueData,
  type IssueStateData,
  type LinkedPR,
  type OctokitLike,
  type ParseIssueOptions,
} from "@more/issue-state";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Minimal domain types (enough for example routing and guards)
// ---------------------------------------------------------------------------

const ExampleProjectStatusSchema = z.union([
  z.null(),
  z.literal("Backlog"),
  z.literal("Triaged"),
  z.literal("Groomed"),
  z.literal("In progress"),
  z.literal("In review"),
  z.literal("Blocked"),
  z.literal("Done"),
  z.literal("Error"),
]);

const ExampleSubIssueSchema = z.object({
  number: z.number().int(),
  projectStatus: ExampleProjectStatusSchema,
  state: z.string(),
});

const ExampleIssueSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string(),
  comments: z.array(z.string()),
  state: z.union([z.literal("OPEN"), z.literal("CLOSED")]),
  projectStatus: ExampleProjectStatusSchema,
  labels: z.array(z.string()),
  assignees: z.array(z.string()),
  hasSubIssues: z.boolean(),
  subIssues: z.array(ExampleSubIssueSchema),
  /** Iteration counter from GitHub Project field (default 0) */
  iteration: z.number().int().min(0).optional().default(0),
  /** CI failure count for circuit breaker (default 0) */
  failures: z.number().int().min(0).optional().default(0),
});

const ExamplePRSchema = z.object({
  number: z.number().int(),
  state: z.union([z.literal("OPEN"), z.literal("MERGED"), z.literal("CLOSED")]),
  isDraft: z.boolean(),
  title: z.string(),
  headRef: z.string(),
  baseRef: z.string(),
  labels: z.array(z.string()),
  reviews: z.array(z.unknown()),
});

const LinkedPRForExtractorSchema = z.object({
  number: z.number().int(),
  state: z.union([z.literal("OPEN"), z.literal("MERGED"), z.literal("CLOSED")]),
  isDraft: z.boolean(),
  title: z.string(),
  headRef: z.string(),
  baseRef: z.string(),
  ciStatus: z
    .union([
      z.literal("SUCCESS"),
      z.literal("FAILURE"),
      z.literal("ERROR"),
      z.literal("PENDING"),
      z.literal("EXPECTED"),
    ])
    .nullable()
    .optional(),
  reviewDecision: z
    .union([
      z.literal("APPROVED"),
      z.literal("CHANGES_REQUESTED"),
      z.literal("REVIEW_REQUIRED"),
    ])
    .nullable()
    .optional(),
  labels: z.array(z.string()),
  reviews: z.array(
    z.object({
      state: z.string(),
      author: z.string(),
      body: z.string(),
    }),
  ),
});

const ExampleIssuePatchSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  state: z.union([z.literal("OPEN"), z.literal("CLOSED")]).optional(),
  projectStatus: ExampleProjectStatusSchema.optional(),
  labels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional(),
  hasSubIssues: z.boolean().optional(),
  subIssues: z.array(ExampleSubIssueSchema).optional(),
});

/** Project status used for routing */
export type ExampleProjectStatus = z.infer<typeof ExampleProjectStatusSchema>;

/** Minimal issue shape for example guards and actions */
export type ExampleIssue = z.infer<typeof ExampleIssueSchema>;

/** Linked PR for "already done" guard */
export type ExamplePR = z.infer<typeof ExamplePRSchema>;

export interface IssueStateRepository {
  setIssueStatus(status: ExampleProjectStatus): void;
  addIssueLabels(labels: string[]): void;
  reconcileSubIssues(subIssueNumbers: number[]): void;
  createSubIssue?(input: {
    title: string;
    body?: string;
    labels?: string[];
  }): Promise<{ issueNumber: number }>;
  assignBotToSubIssue?(
    subIssueNumber: number,
    botUsername: string,
  ): Promise<void>;
  updateSubIssueProjectStatus?(
    subIssueNumber: number,
    status: ExampleProjectStatus,
  ): Promise<void>;
  removeIssueLabels?(labels: string[]): void;
  updateBody?(body: string): void;
  appendHistoryEntry?(entry: {
    phase: string;
    message: string;
    timestamp?: string;
    sha?: string;
    runLink?: string;
  }): void;
  markPRReady?(prNumber: number): Promise<void>;
  requestReviewer?(prNumber: number, reviewer: string): Promise<void>;
}

/**
 * Full example domain context.
 * Mirrors the shape needed by the example machine's guards and actions.
 */
export interface ExampleContext {
  trigger: ExampleTrigger;
  owner: string;
  repo: string;
  issue: ExampleIssue;
  parentIssue: ExampleIssue | null;
  currentSubIssue: ExampleIssue | null;
  pr: ExamplePR | null;
  hasPR: boolean;
  ciResult: ExampleCIResult | null;
  reviewDecision: ExampleReviewDecision | null;
  commentContextType: "issue" | "pr" | null;
  commentContextDescription: string | null;
  ciRunUrl: string | null;
  ciCommitSha: string | null;
  workflowStartedAt: string | null;
  workflowRunUrl: string | null;
  branch: string | null;
  hasBranch: boolean;
  botUsername: string;
  /** Max CI failures before blocking (circuit breaker). Default 3. */
  maxRetries?: number;
  /** Result of branch preparation: clean (no rebase), rebased (force-pushed), or conflicts. */
  branchPrepResult?: "clean" | "rebased" | "conflicts" | null;
  triageOutput?: ExampleTriageOutput | null;
  groomingOutput?: ExampleGroomingOutput | null;
  iterationOutput?: ExampleIterationOutput | null;
  reviewOutput?: ExampleReviewOutput | null;
  prResponseOutput?: ExamplePrResponseOutput | null;
  repository?: IssueStateRepository;
}

const DEFAULT_BOT_USERNAME = "nopo-bot";

// ---------------------------------------------------------------------------
// Context loading skeleton (Sprint 1)
// --------------------------------------------------------------------

interface ContextLoaderOptions {
  octokit: OctokitLike;
  projectNumber?: number;
  trigger: ExampleTrigger;
  owner: string;
  repo: string;
  event: ExampleNormalizedEvent;
  botUsername?: string;
  commentContextType?: "issue" | "pr" | null;
  commentContextDescription?: string | null;
  branch?: string | null;
  ciRunUrl?: string | null;
  workflowStartedAt?: string | null;
  workflowRunUrl?: string | null;
  seed?: Partial<ExampleContext>;
}

type ExampleIssueState = IssueStateData;

type ExampleCommentContext = Pick<
  ExampleContext,
  "commentContextType" | "commentContextDescription"
>;
type ExampleWorkflowContext = Pick<
  ExampleContext,
  "ciRunUrl" | "ciCommitSha" | "workflowStartedAt" | "workflowRunUrl"
>;
type ExampleRuntimeContext = Pick<
  ExampleContext,
  "ciResult" | "reviewDecision" | "botUsername"
>;

interface ExampleContextWritablePatch {
  issue?: Partial<ExampleIssue>;
  pr?: ExamplePR | null;
  branch?: string | null;
  commentContextType?: "issue" | "pr" | null;
  commentContextDescription?: string | null;
}
// ---------------------------------------------------------------------------
// Resource: issue / sub-issue
// ---------------------------------------------------------------------------

function normalizeProjectStatus(
  value: IssueData["projectStatus"],
): ExampleProjectStatus {
  return value === "Ready" ? "In progress" : value;
}

// ---------------------------------------------------------------------------
// Resource: pull request
// ---------------------------------------------------------------------------

const extractLinkedPr = createExtractor(
  z.union([LinkedPRForExtractorSchema, z.null()]),
  (data) => {
    if (data.issue.pr) return data.issue.pr;
    if (data.parentIssue !== null) return null;
    const currentSubIssue = data.issue.subIssues.find(
      (subIssue) =>
        subIssue.projectStatus !== "Done" && subIssue.state === "OPEN",
    );
    if (!currentSubIssue) return null;
    return (
      data.issue.subIssues.find(
        (subIssue) => subIssue.number === currentSubIssue.number,
      )?.pr ?? null
    );
  },
);

function ciResultFromLinkedPr(
  linkedPr: LinkedPR | null,
): ExampleCIResult | null {
  switch (linkedPr?.ciStatus) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    default:
      return null;
  }
}

function reviewDecisionFromLinkedPr(
  linkedPr: LinkedPR | null,
): ExampleReviewDecision | null {
  switch (linkedPr?.reviewDecision) {
    case "APPROVED":
      return "APPROVED";
    case "CHANGES_REQUESTED":
      return "CHANGES_REQUESTED";
    case "REVIEW_REQUIRED":
      return "COMMENTED";
    default:
      return null;
  }
}

const extractIssue = createExtractor(ExampleIssueSchema, (data) => ({
  number: data.issue.number,
  title: data.issue.title,
  body: serializeMarkdown(data.issue.bodyAst),
  comments: data.issue.comments.map((comment) => comment.body),
  state: data.issue.state,
  projectStatus: normalizeProjectStatus(data.issue.projectStatus),
  labels: data.issue.labels,
  assignees: data.issue.assignees,
  hasSubIssues: data.issue.hasSubIssues,
  subIssues: data.issue.subIssues.map((subIssue) => ({
    number: subIssue.number,
    projectStatus: normalizeProjectStatus(subIssue.projectStatus),
    state: subIssue.state,
  })),
  iteration: data.issue.iteration,
  failures: data.issue.failures,
}));

const extractParentIssue = createExtractor(
  z.union([ExampleIssueSchema, z.null()]),
  (data) => {
    if (data.parentIssue === null) return null;
    return {
      number: data.parentIssue.number,
      title: data.parentIssue.title,
      body: serializeMarkdown(data.parentIssue.bodyAst),
      comments: data.parentIssue.comments.map((comment) => comment.body),
      state: data.parentIssue.state,
      projectStatus: normalizeProjectStatus(data.parentIssue.projectStatus),
      labels: data.parentIssue.labels,
      assignees: data.parentIssue.assignees,
      hasSubIssues: data.parentIssue.hasSubIssues,
      subIssues: data.parentIssue.subIssues.map((subIssue) => ({
        number: subIssue.number,
        projectStatus: normalizeProjectStatus(subIssue.projectStatus),
        state: subIssue.state,
      })),
    };
  },
);

const extractCurrentSubIssue = createExtractor(
  z.union([ExampleIssueSchema, z.null()]),
  (data) => {
    if (data.parentIssue !== null) {
      return extractIssue(data);
    }
    const current = data.issue.subIssues.find(
      (subIssue) =>
        subIssue.projectStatus !== "Done" && subIssue.state === "OPEN",
    );
    if (!current) return null;
    return {
      number: current.number,
      title: current.title,
      body: serializeMarkdown(current.bodyAst),
      comments: [],
      state: current.state,
      projectStatus: normalizeProjectStatus(current.projectStatus),
      labels: current.labels,
      assignees: current.assignees,
      hasSubIssues: false,
      subIssues: [],
    };
  },
);

const extractPr = createExtractor(
  z.union([ExamplePRSchema, z.null()]),
  (data) => {
    const linkedPr = extractLinkedPr(data);
    if (!linkedPr) return null;
    return {
      number: linkedPr.number,
      state: linkedPr.state,
      isDraft: linkedPr.isDraft,
      title: linkedPr.title,
      headRef: linkedPr.headRef,
      baseRef: linkedPr.baseRef,
      labels: linkedPr.labels,
      reviews: linkedPr.reviews,
    };
  },
);

const ExampleCIResultSchema = z.union([
  z.literal("success"),
  z.literal("failure"),
  z.literal("cancelled"),
  z.literal("skipped"),
]);

const ExampleReviewDecisionSchema = z.union([
  z.literal("APPROVED"),
  z.literal("CHANGES_REQUESTED"),
  z.literal("COMMENTED"),
]);

const mutateIssueProjectStatus = createMutator(
  z.object({ projectStatus: ExampleProjectStatusSchema }),
  (input, data) => ({
    ...data,
    issue: {
      ...data.issue,
      projectStatus:
        input.projectStatus === "In progress" ? "Ready" : input.projectStatus,
    },
  }),
);

function linkedPrFromExamplePr(value: ExamplePR | null): LinkedPR | null {
  if (value === null) return null;
  const reviews = value.reviews.flatMap((review) => {
    if (typeof review !== "object" || review === null) return [];
    const state = Reflect.get(review, "state");
    const author = Reflect.get(review, "author");
    const body = Reflect.get(review, "body");
    if (
      typeof state !== "string" ||
      typeof author !== "string" ||
      typeof body !== "string"
    ) {
      return [];
    }
    return [{ state, author, body }];
  });
  return {
    number: value.number,
    state: value.state,
    isDraft: value.isDraft,
    title: value.title,
    headRef: value.headRef,
    baseRef: value.baseRef,
    labels: value.labels,
    reviews,
  };
}

const mutateIssue = createMutator(
  ExampleIssuePatchSchema,
  (issuePatch, state) => {
    const projectStatusData = issuePatch.projectStatus
      ? mutateIssueProjectStatus(
          { projectStatus: issuePatch.projectStatus },
          state,
        )
      : state;
    const projectStatus = projectStatusData.issue.projectStatus;
    const nextIssue: IssueData = {
      ...state.issue,
      title: issuePatch.title ?? state.issue.title,
      bodyAst:
        issuePatch.body === undefined
          ? state.issue.bodyAst
          : parseMarkdown(issuePatch.body),
      state: issuePatch.state ?? state.issue.state,
      projectStatus,
      labels: issuePatch.labels ?? state.issue.labels,
      assignees: issuePatch.assignees ?? state.issue.assignees,
      hasSubIssues: issuePatch.hasSubIssues ?? state.issue.hasSubIssues,
      subIssues:
        issuePatch.subIssues === undefined
          ? state.issue.subIssues
          : issuePatch.subIssues.map((subIssue) => {
              const existing = state.issue.subIssues.find(
                (candidate) => candidate.number === subIssue.number,
              );
              return {
                number: subIssue.number,
                title: existing?.title ?? `Sub-issue #${subIssue.number}`,
                state: subIssue.state === "OPEN" ? "OPEN" : "CLOSED",
                bodyAst: existing?.bodyAst ?? parseMarkdown(""),
                projectStatus:
                  subIssue.projectStatus === "In progress"
                    ? "Ready"
                    : subIssue.projectStatus,
                assignees: existing?.assignees ?? [],
                labels: existing?.labels ?? [],
                branch: existing?.branch ?? null,
                pr: existing?.pr ?? null,
              };
            }),
    };
    return { ...state, issue: nextIssue };
  },
);

const mutatePr = createMutator(
  z.union([ExamplePRSchema, z.null()]),
  (pr, state) => ({
    ...state,
    issue: {
      ...state.issue,
      pr: linkedPrFromExamplePr(pr),
    },
  }),
);

const mutateBranch = createMutator(z.string().nullable(), (branch, state) => ({
  ...state,
  issue: { ...state.issue, branch },
}));

export class ExampleContextLoader implements IssueStateRepository {
  private state: ExampleIssueState | null = null;
  private remoteUpdate: ((state: ExampleIssueState) => Promise<void>) | null =
    null;
  private options: ContextLoaderOptions | null = null;
  private contextOverlay: ExampleContextWritablePatch = {};

  private static isOctokitLike(value: unknown): value is OctokitLike {
    if (typeof value !== "object" || value === null) return false;
    if (!("graphql" in value) || !("rest" in value)) return false;
    return true;
  }

  private static resolveOctokit(
    runnerCtx: ExternalRunnerContext,
  ): OctokitLike | null {
    const value = Reflect.get(runnerCtx, "octokit");
    return ExampleContextLoader.isOctokitLike(value) ? value : null;
  }

  static async refreshFromRunnerContext(
    runnerCtx: ExternalRunnerContext,
    current: ExampleContext,
  ): Promise<ExampleContext> {
    const octokit = ExampleContextLoader.resolveOctokit(runnerCtx);
    if (octokit === null) {
      if (current.repository instanceof ExampleContextLoader) {
        const refreshedFromRepository = current.repository.toContext({
          seed: current,
        });
        if (refreshedFromRepository) return refreshedFromRepository;
      }
      return current;
    }

    const loader = new ExampleContextLoader();
    const loaded = await loader.load({
      octokit,
      projectNumber:
        typeof runnerCtx.projectNumber === "number"
          ? runnerCtx.projectNumber
          : undefined,
      trigger: current.trigger,
      owner: current.owner,
      repo: current.repo,
      event: {
        type: "refresh",
        owner: current.owner,
        repo: current.repo,
        issueNumber: current.issue.number,
        timestamp: new Date().toISOString(),
        ...(current.ciResult ? { result: current.ciResult } : {}),
        ...(current.ciRunUrl ? { runUrl: current.ciRunUrl } : {}),
        ...(current.ciCommitSha ? { headSha: current.ciCommitSha } : {}),
        ...(current.reviewDecision ? { decision: current.reviewDecision } : {}),
      },
      botUsername: current.botUsername,
      commentContextType: current.commentContextType,
      commentContextDescription: current.commentContextDescription,
      branch: current.branch,
      ciRunUrl: current.ciRunUrl,
      workflowStartedAt: current.workflowStartedAt,
      workflowRunUrl: current.workflowRunUrl,
      seed: current,
    });
    if (!loaded) return current;

    const next = loader.toContext();
    return next ?? current;
  }

  private requireState(): ExampleIssueState {
    if (this.state === null) {
      throw new Error("Context state is not loaded. Call load() first.");
    }
    return this.state;
  }

  private requireOptions(): ContextLoaderOptions {
    if (this.options === null) {
      throw new Error("Context options are not set. Call load() first.");
    }
    return this.options;
  }

  extractIssue(state: ExampleIssueState = this.requireState()): ExampleIssue {
    return extractIssue(state);
  }

  extractParentIssue(
    state: ExampleIssueState = this.requireState(),
  ): ExampleIssue | null {
    return extractParentIssue(state);
  }

  extractCurrentSubIssue(
    state: ExampleIssueState = this.requireState(),
  ): ExampleIssue | null {
    return extractCurrentSubIssue(state);
  }

  extractLinkedPr(
    state: ExampleIssueState = this.requireState(),
  ): LinkedPR | null {
    return extractLinkedPr(state);
  }

  extractPr(state: ExampleIssueState = this.requireState()): ExamplePR | null {
    return extractPr(state);
  }

  private extractCommentContext(
    options: ContextLoaderOptions,
  ): ExampleCommentContext {
    return {
      commentContextType:
        options.commentContextType ?? options.seed?.commentContextType ?? null,
      commentContextDescription:
        options.commentContextDescription ??
        options.seed?.commentContextDescription ??
        null,
    };
  }

  private extractWorkflowContext(
    options: ContextLoaderOptions,
  ): ExampleWorkflowContext {
    return {
      ciRunUrl: options.ciRunUrl ?? options.event.runUrl ?? null,
      ciCommitSha: options.event.headSha ?? options.seed?.ciCommitSha ?? null,
      workflowStartedAt:
        options.workflowStartedAt ??
        options.seed?.workflowStartedAt ??
        options.event.timestamp,
      workflowRunUrl:
        options.workflowRunUrl ?? options.seed?.workflowRunUrl ?? null,
    };
  }

  private extractBranch(
    state: ExampleIssueState,
    options: ContextLoaderOptions,
  ): string | null {
    const currentSubIssue = this.extractCurrentSubIssue(state);
    const currentSubIssueBranch =
      currentSubIssue === null
        ? null
        : (state.issue.subIssues.find(
            (subIssue) => subIssue.number === currentSubIssue.number,
          )?.branch ?? null);
    return (
      options.branch ??
      currentSubIssueBranch ??
      state.issue.branch ??
      options.seed?.branch ??
      null
    );
  }

  private extractRuntimeContext(
    options: ContextLoaderOptions,
    state: ExampleIssueState,
  ): ExampleRuntimeContext {
    const ciParsed = ExampleCIResultSchema.safeParse(options.event.result);
    const reviewParsed = ExampleReviewDecisionSchema.safeParse(
      options.event.decision,
    );
    const ciFromEvent = ciParsed.success ? ciParsed.data : null;
    const reviewFromEvent = reviewParsed.success ? reviewParsed.data : null;
    const linkedPr = this.extractLinkedPr(state);

    return {
      ciResult:
        ciFromEvent ??
        ciResultFromLinkedPr(linkedPr) ??
        options.seed?.ciResult ??
        null,
      reviewDecision:
        reviewFromEvent ??
        reviewDecisionFromLinkedPr(linkedPr) ??
        options.seed?.reviewDecision ??
        null,
      botUsername:
        options.botUsername ??
        options.seed?.botUsername ??
        DEFAULT_BOT_USERNAME,
    };
  }

  private buildContext(
    state: ExampleIssueState,
    options: ContextLoaderOptions,
  ): ExampleContext {
    const issue = this.extractIssue(state);
    const parentIssue = this.extractParentIssue(state);
    const currentSubIssue = this.extractCurrentSubIssue(state);
    const pr = this.extractPr(state);
    const commentContext = this.extractCommentContext(options);
    const workflowContext = this.extractWorkflowContext(options);
    const branch = this.extractBranch(state, options);
    const runtime = this.extractRuntimeContext(options, state);

    return {
      trigger: options.trigger,
      owner: options.owner,
      repo: options.repo,
      issue,
      parentIssue,
      currentSubIssue,
      pr: pr ?? options.seed?.pr ?? null,
      hasPR: Boolean(pr ?? options.seed?.pr),
      ciResult: runtime.ciResult,
      reviewDecision: runtime.reviewDecision,
      commentContextType: commentContext.commentContextType,
      commentContextDescription: commentContext.commentContextDescription,
      ciRunUrl: workflowContext.ciRunUrl,
      ciCommitSha: workflowContext.ciCommitSha,
      workflowStartedAt: workflowContext.workflowStartedAt,
      workflowRunUrl: workflowContext.workflowRunUrl,
      branch,
      hasBranch: Boolean(branch),
      botUsername: runtime.botUsername,
      branchPrepResult: options.seed?.branchPrepResult ?? null,
      triageOutput: options.seed?.triageOutput ?? null,
      groomingOutput: options.seed?.groomingOutput ?? null,
      iterationOutput: options.seed?.iterationOutput ?? null,
      reviewOutput: options.seed?.reviewOutput ?? null,
      prResponseOutput: options.seed?.prResponseOutput ?? null,
      repository: this,
    };
  }

  private applyContextPatch(
    state: ExampleIssueState,
    updates: ExampleContextWritablePatch,
  ): ExampleIssueState {
    let nextState = state;
    if (updates.issue !== undefined) {
      nextState = mutateIssue(updates.issue, nextState);
    }
    if (updates.pr !== undefined) {
      nextState = mutatePr(updates.pr, nextState);
    }
    if (updates.branch !== undefined) {
      nextState = mutateBranch(updates.branch, nextState);
    }
    return nextState;
  }

  async load(options: ContextLoaderOptions): Promise<boolean> {
    const issueNumber = Number.isFinite(options.event.issueNumber)
      ? options.event.issueNumber
      : 0;
    if (issueNumber <= 0) {
      this.state = null;
      this.remoteUpdate = null;
      this.options = options;
      this.contextOverlay = {};
      return false;
    }

    const resolvedProjectNumber = options.projectNumber ?? 0;
    if (resolvedProjectNumber === 0) {
      console.warn(
        "[ExampleContextLoader] WARNING: projectNumber is 0 — parentIssue will always be null, which allows sub-issues to be groomed (creating duplicates).",
      );
    }
    const parseOptions: ParseIssueOptions = {
      octokit: options.octokit,
      projectNumber: resolvedProjectNumber,
      botUsername:
        options.botUsername ??
        options.seed?.botUsername ??
        DEFAULT_BOT_USERNAME,
      fetchPRs: true,
      fetchParent: true,
    };

    try {
      const parsedResult = await parseIssue(
        options.owner,
        options.repo,
        issueNumber,
        parseOptions,
      );
      this.state = {
        owner: parsedResult.data.owner,
        repo: parsedResult.data.repo,
        issue: parsedResult.data.issue,
        parentIssue: parsedResult.data.parentIssue,
      };
      this.remoteUpdate = parsedResult.update;
      this.options = options;
      this.contextOverlay = {};
      return true;
    } catch {
      this.state = null;
      this.remoteUpdate = null;
      this.options = options;
      this.contextOverlay = {};
      return false;
    }
  }

  getState(): ExampleIssueState | null {
    return this.state;
  }

  toContext(
    overrides: Partial<ContextLoaderOptions> = {},
  ): ExampleContext | null {
    if (this.state === null || this.options === null) return null;
    const mergedOptions: ContextLoaderOptions = {
      ...this.options,
      ...overrides,
      event: overrides.event ?? this.options.event,
      seed: { ...(this.options.seed ?? {}), ...(overrides.seed ?? {}) },
    };
    const context = this.buildContext(this.state, mergedOptions);
    return {
      ...context,
      ...this.contextOverlay,
      issue: this.contextOverlay.issue
        ? { ...context.issue, ...this.contextOverlay.issue }
        : context.issue,
      pr:
        this.contextOverlay.pr === undefined
          ? context.pr
          : this.contextOverlay.pr,
      hasPR: Boolean(
        this.contextOverlay.pr === undefined
          ? context.pr
          : this.contextOverlay.pr,
      ),
      branch:
        this.contextOverlay.branch === undefined
          ? context.branch
          : this.contextOverlay.branch,
      hasBranch: Boolean(
        this.contextOverlay.branch === undefined
          ? context.branch
          : this.contextOverlay.branch,
      ),
      repository: this,
    };
  }

  toState(updates: ExampleContextWritablePatch): ExampleIssueState | null {
    if (this.state === null) return null;
    this.state = this.applyContextPatch(this.state, updates);
    this.contextOverlay = { ...this.contextOverlay, ...updates };
    return this.state;
  }

  updateIssue(issue: Partial<ExampleIssue>): ExampleIssueState | null {
    return this.toState({ issue });
  }

  updatePr(pr: ExamplePR | null): ExampleIssueState | null {
    return this.toState({ pr });
  }

  updateBranch(branch: string | null): ExampleIssueState | null {
    return this.toState({ branch });
  }

  setIssueStatus(status: ExampleProjectStatus): void {
    this.updateIssue({ projectStatus: status });
  }

  updateBody(body: string): void {
    this.updateIssue({ body });
  }

  appendHistoryEntry(entry: {
    phase: string;
    message: string;
    timestamp?: string;
    sha?: string;
    runLink?: string;
  }): void {
    const state = this.requireState();
    const ast = state.issue.bodyAst;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- mdast recursive types require assertion
    const children = ast.children as Array<{
      type: string;
      depth?: number;
      children?: Array<{ type: string; value?: string; children?: unknown[] }>;
      align?: (string | null)[];
    }>;

    // Find existing "Iteration History" heading
    let headingIdx = -1;
    for (let i = 0; i < children.length; i++) {
      const node = children[i]!;
      if (
        node.type === "heading" &&
        node.depth === 2 &&
        node.children?.[0]?.type === "text" &&
        node.children[0].value === "Iteration History"
      ) {
        headingIdx = i;
        break;
      }
    }

    // Format timestamp
    const ts = entry.timestamp ?? new Date().toISOString();
    let timeCell = "-";
    try {
      const d = new Date(ts);
      if (!isNaN(d.getTime())) {
        const months = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        timeCell = `${months[d.getUTCMonth()]} ${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      }
    } catch {
      // keep "-"
    }

    // Count existing data rows for iteration number
    let iteration = 1;
    if (headingIdx !== -1) {
      const tableNode = children[headingIdx + 1];
      if (tableNode?.type === "table" && tableNode.children) {
        // First child is header row, rest are data
        iteration = tableNode.children.length; // includes header, so this = dataRows + 1
      }
    }

    // Build new table row as AST
    const cell = (text: string) => ({
      type: "tableCell" as const,
      children: [{ type: "text" as const, value: text }],
    });
    const newRow = {
      type: "tableRow" as const,
      children: [
        cell(timeCell),
        cell(String(iteration)),
        cell(entry.phase),
        cell(entry.message),
        cell(entry.sha ? `\`${entry.sha.slice(0, 7)}\`` : "-"),
        cell(entry.runLink ?? "-"),
      ],
    };

    if (headingIdx !== -1 && children[headingIdx + 1]?.type === "table") {
      // Append row to existing table
      const table = children[headingIdx + 1]!;
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- mdast table children manipulation
      (table.children as unknown[]).push(newRow);
    } else {
      // Create heading + table with header row + data row
      const headerRow = {
        type: "tableRow" as const,
        children: [
          cell("Time"),
          cell("#"),
          cell("Phase"),
          cell("Action"),
          cell("SHA"),
          cell("Run"),
        ],
      };
      const table = {
        type: "table" as const,
        align: [null, null, null, null, null, null],
        children: [headerRow, newRow],
      };
      const heading = {
        type: "heading" as const,
        depth: 2 as const,
        children: [{ type: "text" as const, value: "Iteration History" }],
      };
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- mdast node insertion
      children.push(heading as (typeof children)[number]);
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- mdast node insertion
      children.push(table as (typeof children)[number]);
    }
  }

  addIssueLabels(labels: string[]): void {
    const state = this.requireState();
    const current = extractIssue(state).labels;
    const merged = [...new Set([...current, ...labels])];
    this.updateIssue({ labels: merged });
  }

  removeIssueLabels(labels: string[]): void {
    const state = this.requireState();
    const current = extractIssue(state).labels;
    const filtered = current.filter(
      (l) => !labels.some((r) => r.toLowerCase() === l.toLowerCase()),
    );
    this.updateIssue({ labels: filtered });
  }

  reconcileSubIssues(subIssueNumbers: number[]): void {
    const state = this.requireState();
    const current = extractIssue(state);
    const byNumber = new Map(
      current.subIssues.map((subIssue) => [subIssue.number, subIssue]),
    );
    const nextSubIssues = subIssueNumbers.map((number) => {
      const existing = byNumber.get(number);
      return {
        number,
        projectStatus: existing?.projectStatus ?? "Backlog",
        state: existing?.state ?? "OPEN",
      };
    });
    this.updateIssue({
      hasSubIssues: nextSubIssues.length > 0,
      subIssues: nextSubIssues,
    });
  }

  async createSubIssue(input: {
    title: string;
    body?: string;
    labels?: string[];
  }): Promise<{ issueNumber: number }> {
    const options = this.requireOptions();
    const state = this.requireState();
    const parentIssue = extractIssue(state);
    const result = await addSubIssueToParent(
      options.owner,
      options.repo,
      parentIssue.number,
      {
        title: input.title,
        body: input.body,
        labels: input.labels,
      },
      {
        octokit: options.octokit,
        projectNumber: options.projectNumber,
        projectStatus: "Ready",
      },
    );
    // Update local state to reflect the new sub-issue
    const current = extractIssue(state);
    this.updateIssue({
      hasSubIssues: true,
      subIssues: [
        ...current.subIssues,
        {
          number: result.issueNumber,
          projectStatus: "Backlog",
          state: "OPEN",
        },
      ],
    });
    return { issueNumber: result.issueNumber };
  }

  async assignBotToSubIssue(
    subIssueNumber: number,
    botUsername: string,
  ): Promise<void> {
    const options = this.requireOptions();
    await options.octokit.rest.issues.addAssignees({
      owner: options.owner,
      repo: options.repo,
      issue_number: subIssueNumber,
      assignees: [botUsername],
    });
  }

  async updateSubIssueProjectStatus(
    subIssueNumber: number,
    status: ExampleProjectStatus,
  ): Promise<void> {
    const options = this.requireOptions();
    await updateProjectFields(
      options.octokit,
      options.owner,
      options.repo,
      subIssueNumber,
      options.projectNumber ?? 0,
      { status: status === "In progress" ? "Ready" : status },
    );
  }

  async markPRReady(prNumber: number): Promise<void> {
    const options = this.requireOptions();
    const { repository } = await options.octokit.graphql<{
      repository: { pullRequest: { id: string } };
    }>(GET_PR_ID_QUERY, {
      owner: options.owner,
      repo: options.repo,
      prNumber,
    });
    await options.octokit.graphql(MARK_PR_READY_MUTATION, {
      prId: repository.pullRequest.id,
    });
    this.updatePr({
      ...(this.extractPr() ?? {
        number: prNumber,
        state: "OPEN",
        isDraft: false,
        title: "",
        headRef: "",
        baseRef: "",
        labels: [],
        reviews: [],
      }),
      isDraft: false,
    });
  }

  async requestReviewer(prNumber: number, reviewer: string): Promise<void> {
    const options = this.requireOptions();
    await options.octokit.rest.pulls.requestReviewers({
      owner: options.owner,
      repo: options.repo,
      pull_number: prNumber,
      reviewers: [reviewer],
    });
  }

  async save(): Promise<boolean> {
    if (this.state === null || this.remoteUpdate === null) return false;
    await this.remoteUpdate(this.state);
    return true;
  }
}
