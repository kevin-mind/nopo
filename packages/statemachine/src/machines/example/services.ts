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
  priority?: "none" | "low" | "medium" | "high" | "critical";
  size?: "xs" | "s" | "m" | "l" | "xl";
  estimate?: number;
  requirements?: string[];
  initialQuestions?: string[];
  relatedIssues?: number[];
  agentNotes?: string[];
}

export interface ExampleGroomingOutput {
  labelsToAdd: string[];
  summary: string;
  decision: "ready" | "needs_info" | "blocked";
  /** Engineer's recommended phases (used by reconcileSubIssues) */
  recommendedPhases?: Array<{
    phase_number: number;
    title: string;
    description: string;
    affected_areas?: Array<{
      path: string;
      change_type?: string;
      description?: string;
    }>;
    todos?: Array<{ task: string; manual?: boolean }>;
    depends_on?: number[];
  }>;
  /** Questions for the issue body when decision is needs_info */
  consolidatedQuestions?: Array<{
    id: string;
    title: string;
    description: string;
    priority: string;
  }>;
  /** Previously asked questions that are now answered */
  answeredQuestions?: Array<{
    id: string;
    title: string;
    answer_summary: string;
  }>;
  blockerReason?: string;
}

export interface ExampleIterationOutput {
  labelsToAdd: string[];
  summary: string;
  /** When status is completed_todo or all_done, list of todo texts to check off */
  todosCompleted?: string[];
  status?: "completed_todo" | "waiting_manual" | "blocked" | "all_done";
}

export interface ExampleReviewOutput {
  decision: "approve" | "request_changes" | "comment";
  body: string;
  agentNotes?: string[];
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
  submitReview(input: {
    owner: string;
    repo: string;
    prNumber: number;
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
    body: string;
  }): Promise<void>;
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
  triage: ExampleTriageService;
  grooming: ExampleGroomingService;
  iteration: ExampleIterationService;
  review: ExampleReviewService;
  prResponse: ExamplePrResponseService;
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
    priority: z.enum(["none", "low", "medium", "high", "critical"]).optional(),
    size: z.enum(["xs", "s", "m", "l", "xl"]).optional(),
    estimate: z
      .union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(5),
        z.literal(8),
        z.literal(13),
        z.literal(21),
      ])
      .optional(),
    topics: z.array(z.string()),
    needs_info: z.boolean(),
  }),
  requirements: z.array(z.string()).optional(),
  initial_approach: z.string(),
  initial_questions: z.array(z.string()).optional(),
  related_issues: z.array(z.number()).optional(),
  agent_notes: z.array(z.string()).optional(),
});

const ClaudeGroomingSummaryOutputSchema = z.object({
  summary: z.string(),
  decision: z.enum(["ready", "needs_info", "blocked"]),
  decision_rationale: z.string(),
  consolidated_questions: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
        sources: z.array(z.string()),
        priority: z.enum(["critical", "important", "nice-to-have"]),
      }),
    )
    .optional(),
  answered_questions: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        answer_summary: z.string(),
      }),
    )
    .optional(),
  blocker_reason: z.string().optional(),
  agent_notes: z.array(z.string()).optional(),
});

const ClaudeIterationOutputSchema = z.object({
  status: z.enum(["completed_todo", "waiting_manual", "blocked", "all_done"]),
  todos_completed: z.array(z.string()).optional(),
  manual_todo: z.string().optional(),
  blocked_reason: z.string().optional(),
  agent_notes: z.array(z.string()),
});

const ClaudeReviewOutputSchema = z.object({
  decision: z.enum(["approve", "request_changes", "comment"]),
  body: z.string(),
  agent_notes: z.array(z.string()).optional(),
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
    `type:${parsed.triage.type}`,
    ...(parsed.triage.needs_info ? ["needs-info"] : []),
    ...topicLabels,
  ];
  return {
    labelsToAdd: [...new Set(labelsToAdd)],
    summary: parsed.initial_approach,
    priority: parsed.triage.priority,
    size: parsed.triage.size,
    estimate: parsed.triage.estimate,
    requirements:
      parsed.requirements && parsed.requirements.length > 0
        ? parsed.requirements
        : undefined,
    initialQuestions:
      parsed.initial_questions && parsed.initial_questions.length > 0
        ? parsed.initial_questions
        : undefined,
    relatedIssues:
      parsed.related_issues && parsed.related_issues.length > 0
        ? parsed.related_issues
        : undefined,
    agentNotes:
      parsed.agent_notes && parsed.agent_notes.length > 0
        ? parsed.agent_notes
        : undefined,
  };
}

/** Schema for engineer agent output (extracts recommended_phases) */
const ClaudeEngineerOutputSchema = z.object({
  implementation_plan: z.string(),
  recommended_phases: z.array(
    z.object({
      phase_number: z.number(),
      title: z.string(),
      description: z.string(),
      affected_areas: z
        .array(
          z.object({
            path: z.string(),
            change_type: z.string().optional(),
            description: z.string().optional(),
          }),
        )
        .optional(),
      todos: z
        .array(z.object({ task: z.string(), manual: z.boolean().optional() }))
        .optional(),
      depends_on: z.array(z.number()).optional(),
    }),
  ),
});

function mapGroomingSummaryToOutput(
  summaryOutput: unknown,
  engineerOutput: unknown,
): ExampleGroomingOutput {
  const summary = ClaudeGroomingSummaryOutputSchema.parse(summaryOutput);
  const labelsToAdd: string[] = [];
  const engineer = ClaudeEngineerOutputSchema.safeParse(engineerOutput);
  return {
    labelsToAdd: [...new Set(labelsToAdd.map(normalizeLabelPart))],
    summary: summary.summary,
    decision: summary.decision,
    recommendedPhases: engineer.success
      ? engineer.data.recommended_phases
      : undefined,
    consolidatedQuestions: summary.consolidated_questions?.map((q) => ({
      id: q.id,
      title: q.title,
      description: q.description,
      priority: q.priority,
    })),
    answeredQuestions: summary.answered_questions,
    blockerReason: summary.blocker_reason,
  };
}

function mapClaudeOutputToIterationResult(
  output: unknown,
): ExampleIterationOutput {
  const parsed = ClaudeIterationOutputSchema.parse(output);
  return {
    labelsToAdd: [],
    summary: parsed.agent_notes.join("; ") || parsed.status,
    status: parsed.status,
    todosCompleted:
      parsed.todos_completed && parsed.todos_completed.length > 0
        ? parsed.todos_completed
        : undefined,
  };
}

function mapClaudeOutputToReviewResult(output: unknown): ExampleReviewOutput {
  const parsed = ClaudeReviewOutputSchema.parse(output);
  return {
    decision: parsed.decision,
    body: parsed.body,
    agentNotes: parsed.agent_notes,
  };
}

function mapClaudeOutputToPrResponseResult(
  output: unknown,
): ExamplePrResponseOutput {
  const parsed = ClaudePrResponseOutputSchema.parse(output);
  const labelsToAdd = [...parsed.pr_response.labels_to_add];
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
  const envOverrides = codeToken ? { GH_TOKEN: codeToken } : undefined;
  const cwd = process.cwd();

  async function runAgent(
    promptDir: string,
    promptVars: Record<string, string>,
    label: string,
  ): Promise<unknown> {
    const resolved = resolvePrompt({ promptDir, promptVars });
    const result = await executeClaudeSDK({
      prompt: resolved.prompt,
      cwd,
      outputSchema: resolved.outputSchema,
      ...(envOverrides && { envOverrides }),
    });
    if (!result.success || !result.structuredOutput) {
      throw new Error(
        result.error ??
          `Claude ${label} agent failed (exitCode=${result.exitCode})`,
      );
    }
    return result.structuredOutput;
  }

  return {
    async groomIssue(input) {
      const vars = input.promptVars;

      // Step 1: Run 4 grooming agents in parallel
      const [engineerOutput, pmOutput, qaOutput, researchOutput] =
        await Promise.all([
          runAgent("grooming/engineer", vars, "engineer"),
          runAgent("grooming/pm", vars, "pm"),
          runAgent("grooming/qa", vars, "qa"),
          runAgent("grooming/research", vars, "research"),
        ]);

      // Step 2: Feed agent outputs to summary prompt
      const summaryVars: Record<string, string> = {
        ISSUE_NUMBER: vars.ISSUE_NUMBER,
        ISSUE_TITLE: vars.ISSUE_TITLE,
        ISSUE_BODY: vars.ISSUE_BODY,
        ISSUE_COMMENTS: vars.ISSUE_COMMENTS,
        PM_OUTPUT: JSON.stringify(pmOutput),
        ENGINEER_OUTPUT: JSON.stringify(engineerOutput),
        QA_OUTPUT: JSON.stringify(qaOutput),
        RESEARCH_OUTPUT: JSON.stringify(researchOutput),
      };

      const summaryOutput = await runAgent(
        "grooming/summary",
        summaryVars,
        "summary",
      );

      return mapGroomingSummaryToOutput(summaryOutput, engineerOutput);
    },
  };
}

export function createClaudeIterationService(
  codeToken?: string,
): ExampleIterationService {
  return {
    async iterateIssue(input) {
      const resolved = resolvePrompt({
        promptDir: "iterate",
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
    async submitReview(input) {
      const token = reviewerToken ?? process.env.GITHUB_TOKEN;
      if (!token) {
        throw new Error("No reviewer token available for submitting review");
      }
      const response = await fetch(
        `https://api.github.com/repos/${input.owner}/${input.repo}/pulls/${input.prNumber}/reviews`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            event: input.event,
            body: input.body,
          }),
        },
      );
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Failed to submit review: ${response.status} ${errorBody}`,
        );
      }
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
