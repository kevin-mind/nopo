/**
 * Zod schemas for Claude structured output parsing.
 *
 * Replaces type-only interfaces with runtime validation.
 * Each schema matches the JSON structure returned by Claude's structured output.
 */

import { z } from "zod";

// ============================================================================
// Shared Helper
// ============================================================================

/**
 * Parse and validate structured output from Claude or a JSON file.
 * Throws a descriptive ZodError on malformed data instead of silently
 * producing garbage via type assertion.
 */
export function parseOutput<T>(
  schema: z.ZodType<T>,
  data: unknown,
  label: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid ${label} output:\n${issues}\nData: ${JSON.stringify(data, null, 2).slice(0, 500)}`,
    );
  }
  return result.data;
}

// ============================================================================
// Iterate Output
// ============================================================================

export const IterateOutputSchema = z.object({
  status: z.enum(["completed_todo", "waiting_manual", "blocked", "all_done"]),
  todos_completed: z.array(z.string()).optional(),
  todo_completed: z.string().optional(),
  agent_notes: z.array(z.string()),
  manual_todo: z.string().optional(),
  blocked_reason: z.string().optional(),
});

export type IterateOutput = z.infer<typeof IterateOutputSchema>;

// ============================================================================
// Review Output
// ============================================================================

export const ReviewOutputSchema = z.object({
  decision: z.enum(["approve", "request_changes", "comment"]),
  body: z.string(),
});

export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

// ============================================================================
// PR Response Output
// ============================================================================

export const PRResponseOutputSchema = z.object({
  had_commits: z.boolean(),
  summary: z.string(),
  commits: z.array(z.string()).optional(),
  agent_notes: z.array(z.string()).optional(),
});

export type PRResponseOutput = z.infer<typeof PRResponseOutputSchema>;

// ============================================================================
// Pivot Output
// ============================================================================

const TodoModificationSchema = z.object({
  action: z.enum(["add", "modify", "remove"]),
  index: z.number(),
  text: z.string().optional(),
});

const SubIssueModificationSchema = z.object({
  issue_number: z.number(),
  action: z.enum(["modify", "skip"]),
  todo_modifications: z.array(TodoModificationSchema).optional(),
  update_description: z.string().optional(),
});

const NewSubIssueSchema = z.object({
  title: z.string(),
  description: z.string(),
  todos: z.array(z.string()),
  reason: z.enum(["reversion", "new_scope", "extension"]),
});

export const PivotOutputSchema = z.object({
  analysis: z.object({
    change_summary: z.string(),
    affects_completed_work: z.boolean(),
    completed_work_details: z
      .array(
        z.object({
          type: z.enum(["checked_todo", "closed_sub_issue"]),
          issue_number: z.number(),
          description: z.string(),
        }),
      )
      .optional(),
  }),
  modifications: z
    .object({
      parent_issue: z
        .object({
          update_sections: z.record(z.string()).optional(),
        })
        .optional(),
      sub_issues: z.array(SubIssueModificationSchema).optional(),
      new_sub_issues: z.array(NewSubIssueSchema).optional(),
    })
    .optional(),
  outcome: z.enum([
    "changes_applied",
    "needs_clarification",
    "no_changes_needed",
  ]),
  clarification_needed: z.string().optional(),
  summary_for_user: z.string(),
});

export type PivotOutput = z.infer<typeof PivotOutputSchema>;

// ============================================================================
// Grooming Output
// ============================================================================

const GroomingAgentOutputSchema = z
  .object({
    ready: z.boolean(),
    questions: z.array(z.string()).optional(),
  })
  .passthrough();

const RecommendedPhaseSchema = z.object({
  phase_number: z.number(),
  title: z.string(),
  description: z.string(),
  affected_areas: z
    .array(
      z.object({
        path: z.string(),
        change_type: z.string().optional(),
        description: z.string().optional(),
        impact: z.string().optional(),
      }),
    )
    .optional(),
  todos: z
    .array(
      z.object({
        task: z.string(),
        manual: z.boolean().optional(),
      }),
    )
    .optional(),
  depends_on: z.array(z.number()).optional(),
});

export type RecommendedPhase = z.infer<typeof RecommendedPhaseSchema>;

export const EngineerOutputSchema = GroomingAgentOutputSchema.extend({
  recommended_phases: z.array(RecommendedPhaseSchema),
});

export const CombinedGroomingOutputSchema = z.object({
  pm: GroomingAgentOutputSchema,
  engineer: GroomingAgentOutputSchema,
  qa: GroomingAgentOutputSchema,
  research: GroomingAgentOutputSchema,
});

export type CombinedGroomingOutput = z.infer<
  typeof CombinedGroomingOutputSchema
>;

// ============================================================================
// Triage Output
// ============================================================================

const TriageClassificationSchema = z.object({
  type: z.string(),
  priority: z.string().nullable().optional(),
  size: z.string(),
  estimate: z.number(),
  topics: z.array(z.string()),
  needs_info: z.boolean(),
});

export type TriageClassification = z.infer<typeof TriageClassificationSchema>;

export const TriageOutputSchema = z.object({
  triage: TriageClassificationSchema,
  requirements: z.array(z.string()),
  initial_approach: z.string(),
  initial_questions: z.array(z.string()).optional(),
  related_issues: z.array(z.number()).optional(),
  agent_notes: z.array(z.string()).optional(),
});

export type TriageOutput = z.infer<typeof TriageOutputSchema>;

export const LegacyTriageOutputSchema = z.object({
  type: z.string().optional(),
  priority: z.string().nullable().optional(),
  size: z.string().optional(),
  estimate: z.number().optional(),
  topics: z.array(z.string()).optional(),
  needs_info: z.boolean().optional(),
  sub_issues: z
    .array(
      z.object({
        type: z.string(),
        title: z.string(),
        description: z.string(),
        todos: z.array(
          z.union([
            z.object({ task: z.string(), manual: z.boolean() }),
            z.string(),
          ]),
        ),
      }),
    )
    .optional(),
  issue_body: z.string().optional(),
  related_issues: z.array(z.number()).optional(),
});

export type LegacyTriageOutput = z.infer<typeof LegacyTriageOutputSchema>;

// ============================================================================
// Discussion Output
// ============================================================================

export const ResearchOutputSchema = z.object({
  research_threads: z.array(
    z.object({
      title: z.string(),
      question: z.string(),
      investigation_areas: z.array(z.string()),
      expected_deliverables: z.array(z.string()),
    }),
  ),
  updated_description: z.string().optional(),
});

export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

export const RespondOutputSchema = z.object({
  response: z.string(),
  should_continue: z.boolean(),
});

export type RespondOutput = z.infer<typeof RespondOutputSchema>;

export const SummarizeOutputSchema = z.object({
  summary: z.string(),
});

export type SummarizeOutput = z.infer<typeof SummarizeOutputSchema>;

export const PlanOutputSchema = z.object({
  issues: z.array(
    z.object({
      title: z.string(),
      body: z.string(),
      labels: z.array(z.string()),
    }),
  ),
  summary_comment: z.string(),
});

export type PlanOutput = z.infer<typeof PlanOutputSchema>;
