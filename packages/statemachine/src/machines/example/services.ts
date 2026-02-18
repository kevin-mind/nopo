import { executeClaudeSDK, resolvePrompt } from "@more/claude";
import { z } from "zod";

export interface TriagePromptVars extends Record<string, string> {
  ISSUE_NUMBER: string;
  ISSUE_TITLE: string;
  ISSUE_BODY: string;
  ISSUE_COMMENTS: string;
}

export interface ExampleTriageOutput {
  labelsToAdd: string[];
  summary: string;
}

export interface ExampleGroomingOutput {
  labelsToAdd: string[];
  suggestedSubIssueNumbers: number[];
  summary: string;
}

export interface ExampleIterationOutput {
  labelsToAdd: string[];
  summary: string;
  /** When status is completed_todo or all_done, list of todo texts to check off */
  todosCompleted?: string[];
  status?: "completed_todo" | "waiting_manual" | "blocked" | "all_done";
}

export interface ExampleReviewOutput {
  labelsToAdd: string[];
  summary: string;
}

export interface ExamplePrResponseOutput {
  labelsToAdd: string[];
  summary: string;
}

interface ExampleTriageService {
  triageIssue(input: {
    issueNumber: number;
    promptVars: TriagePromptVars;
  }): Promise<ExampleTriageOutput>;
}

interface ExampleGroomingService {
  groomIssue(input: {
    issueNumber: number;
    promptVars: TriagePromptVars & { ISSUE_LABELS: string };
  }): Promise<ExampleGroomingOutput>;
}

interface ExampleIterationService {
  iterateIssue(input: {
    issueNumber: number;
    mode: "iterate" | "retry";
    promptVars: TriagePromptVars & {
      ISSUE_LABELS: string;
      CI_RESULT: string;
      REVIEW_DECISION: string;
    };
  }): Promise<ExampleIterationOutput>;
}

interface ExampleReviewService {
  reviewIssue(input: {
    issueNumber: number;
    promptVars: TriagePromptVars & {
      REVIEW_DECISION: string;
      REVIEWER: string;
    };
  }): Promise<ExampleReviewOutput>;
}

interface ExamplePrResponseService {
  respondToPr(input: {
    issueNumber: number;
    promptVars: TriagePromptVars & {
      REVIEW_DECISION: string;
      REVIEWER: string;
    };
  }): Promise<ExamplePrResponseOutput>;
}

export interface ExampleServices {
  triage?: ExampleTriageService;
  grooming?: ExampleGroomingService;
  iteration?: ExampleIterationService;
  review?: ExampleReviewService;
  prResponse?: ExamplePrResponseService;
}

const ClaudeTriageOutputSchema = z.object({
  triage: z.object({
    type: z.enum([
      "bug",
      "enhancement",
      "documentation",
      "refactor",
      "test",
      "chore",
    ]),
    topics: z.array(z.string()),
    needs_info: z.boolean(),
  }),
  initial_approach: z.string(),
});

const ClaudeGroomingOutputSchema = z.object({
  grooming: z.object({
    labels_to_add: z.array(z.string()),
    suggested_sub_issues: z.array(
      z.object({
        number: z.number().int().positive(),
      }),
    ),
  }),
  implementation_plan: z.string(),
});

const ClaudeIterationOutputSchema = z.object({
  iteration: z.object({
    labels_to_add: z.array(z.string()),
  }),
  implementation_notes: z.string(),
  status: z
    .enum(["completed_todo", "waiting_manual", "blocked", "all_done"])
    .optional(),
  todos_completed: z.array(z.string()).optional(),
  todo_completed: z.string().optional(),
});

const ClaudeReviewOutputSchema = z.object({
  review: z.object({
    labels_to_add: z.array(z.string()),
  }),
  summary: z.string(),
});

const ClaudePrResponseOutputSchema = z.object({
  pr_response: z.object({
    labels_to_add: z.array(z.string()),
  }),
  summary: z.string(),
});

function normalizeLabelPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function mapClaudeOutputToTriageResult(output: unknown): ExampleTriageOutput {
  const parsed = ClaudeTriageOutputSchema.parse(output);
  const topicLabels = parsed.triage.topics.map(
    (topic) => `topic:${normalizeLabelPart(topic)}`,
  );
  const labelsToAdd = [
    "triaged",
    `type:${parsed.triage.type}`,
    ...(parsed.triage.needs_info ? ["needs-info"] : []),
    ...topicLabels,
  ];
  return {
    labelsToAdd: [...new Set(labelsToAdd)],
    summary: parsed.initial_approach,
  };
}

function mapClaudeOutputToGroomingResult(
  output: unknown,
): ExampleGroomingOutput {
  const parsed = ClaudeGroomingOutputSchema.parse(output);
  const labelsToAdd = ["groomed", ...parsed.grooming.labels_to_add];
  return {
    labelsToAdd: [...new Set(labelsToAdd.map(normalizeLabelPart))],
    suggestedSubIssueNumbers: [
      ...new Set(
        parsed.grooming.suggested_sub_issues.map((item) => item.number),
      ),
    ],
    summary: parsed.implementation_plan,
  };
}

function mapClaudeOutputToIterationResult(
  output: unknown,
): ExampleIterationOutput {
  const parsed = ClaudeIterationOutputSchema.parse(output);
  const labelsToAdd = ["iteration:ready", ...parsed.iteration.labels_to_add];
  const todosCompleted =
    parsed.todos_completed && parsed.todos_completed.length > 0
      ? parsed.todos_completed
      : parsed.todo_completed
        ? [parsed.todo_completed]
        : undefined;
  return {
    labelsToAdd: [...new Set(labelsToAdd.map(normalizeLabelPart))],
    summary: parsed.implementation_notes,
    status: parsed.status,
    todosCompleted,
  };
}

function mapClaudeOutputToReviewResult(output: unknown): ExampleReviewOutput {
  const parsed = ClaudeReviewOutputSchema.parse(output);
  const labelsToAdd = ["reviewed", ...parsed.review.labels_to_add];
  return {
    labelsToAdd: [...new Set(labelsToAdd.map(normalizeLabelPart))],
    summary: parsed.summary,
  };
}

function mapClaudeOutputToPrResponseResult(
  output: unknown,
): ExamplePrResponseOutput {
  const parsed = ClaudePrResponseOutputSchema.parse(output);
  const labelsToAdd = [
    "response-prepared",
    ...parsed.pr_response.labels_to_add,
  ];
  return {
    labelsToAdd: [...new Set(labelsToAdd.map(normalizeLabelPart))],
    summary: parsed.summary,
  };
}

export function createClaudeTriageService(
  codeToken?: string,
): ExampleTriageService {
  return {
    async triageIssue(input) {
      const resolved = resolvePrompt({
        promptDir: "triage",
        promptVars: input.promptVars,
      });
      const result = await executeClaudeSDK({
        prompt: resolved.prompt,
        cwd: process.cwd(),
        outputSchema: resolved.outputSchema,
        ...(codeToken && { envOverrides: { GH_TOKEN: codeToken } }),
      });
      if (!result.success || !result.structuredOutput) {
        throw new Error(
          result.error ??
            `Claude triage failed for issue #${input.issueNumber} (exitCode=${result.exitCode})`,
        );
      }
      return mapClaudeOutputToTriageResult(result.structuredOutput);
    },
  };
}

export function createClaudeGroomingService(
  codeToken?: string,
): ExampleGroomingService {
  return {
    async groomIssue(input) {
      const resolved = resolvePrompt({
        promptDir: "grooming",
        promptVars: input.promptVars,
      });
      const result = await executeClaudeSDK({
        prompt: resolved.prompt,
        cwd: process.cwd(),
        outputSchema: resolved.outputSchema,
        ...(codeToken && { envOverrides: { GH_TOKEN: codeToken } }),
      });
      if (!result.success || !result.structuredOutput) {
        throw new Error(
          result.error ??
            `Claude grooming failed for issue #${input.issueNumber} (exitCode=${result.exitCode})`,
        );
      }
      return mapClaudeOutputToGroomingResult(result.structuredOutput);
    },
  };
}

export function createClaudeIterationService(
  codeToken?: string,
): ExampleIterationService {
  return {
    async iterateIssue(input) {
      const resolved = resolvePrompt({
        promptDir: input.mode === "retry" ? "retry" : "iterate",
        promptVars: input.promptVars,
      });
      const result = await executeClaudeSDK({
        prompt: resolved.prompt,
        cwd: process.cwd(),
        outputSchema: resolved.outputSchema,
        ...(codeToken && { envOverrides: { GH_TOKEN: codeToken } }),
      });
      if (!result.success || !result.structuredOutput) {
        throw new Error(
          result.error ??
            `Claude iteration failed for issue #${input.issueNumber} (exitCode=${result.exitCode})`,
        );
      }
      return mapClaudeOutputToIterationResult(result.structuredOutput);
    },
  };
}

export function createClaudeReviewService(
  reviewerToken?: string,
): ExampleReviewService {
  return {
    async reviewIssue(input) {
      const resolved = resolvePrompt({
        promptDir: "review",
        promptVars: input.promptVars,
      });
      const result = await executeClaudeSDK({
        prompt: resolved.prompt,
        cwd: process.cwd(),
        outputSchema: resolved.outputSchema,
        ...(reviewerToken && { envOverrides: { GH_TOKEN: reviewerToken } }),
      });
      if (!result.success || !result.structuredOutput) {
        throw new Error(
          result.error ??
            `Claude review failed for issue #${input.issueNumber} (exitCode=${result.exitCode})`,
        );
      }
      return mapClaudeOutputToReviewResult(result.structuredOutput);
    },
  };
}

export function createClaudePrResponseService(
  codeToken?: string,
): ExamplePrResponseService {
  return {
    async respondToPr(input) {
      const resolved = resolvePrompt({
        promptDir: "review-response",
        promptVars: input.promptVars,
      });
      const result = await executeClaudeSDK({
        prompt: resolved.prompt,
        cwd: process.cwd(),
        outputSchema: resolved.outputSchema,
        ...(codeToken && { envOverrides: { GH_TOKEN: codeToken } }),
      });
      if (!result.success || !result.structuredOutput) {
        throw new Error(
          result.error ??
            `Claude PR response failed for issue #${input.issueNumber} (exitCode=${result.exitCode})`,
        );
      }
      return mapClaudeOutputToPrResponseResult(result.structuredOutput);
    },
  };
}
