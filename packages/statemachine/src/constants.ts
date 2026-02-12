/**
 * Domain-specific constants for the state machine.
 *
 * All emoji icons, history messages, section heading names, and body structure
 * schemas are defined here and imported by machine/actions.ts, parser/extractors.ts,
 * parser/mutators.ts, and the verification system.
 *
 * @more/issue-state remains a pure parser with no domain knowledge.
 */

import { z } from "zod";
import {
  TodoStatsSchema,
  HistoryEntrySchema,
  AgentNotesEntrySchema,
} from "@more/issue-state";

// ============================================================================
// History Icons
// ============================================================================

/**
 * Emoji characters used as history entry prefixes.
 */
export const HISTORY_ICONS = {
  ITERATING: "⏳",
  CI_PASSED: "✅",
  CI_FAILED: "❌",
  BLOCKED: "🚫",
  REVIEW_REQUESTED: "👀",
  MERGED: "🚢",
  INITIALIZED: "🚀",
  PHASE_ADVANCED: "⏭️",
  CODE_PUSHED: "📝",
  WARNING: "⚠️",
} as const;

// ============================================================================
// History Messages
// ============================================================================

/**
 * Static and dynamic history message builders.
 * Compose HISTORY_ICONS into full history action messages.
 */
export const HISTORY_MESSAGES = {
  // Iteration
  ITERATING: `${HISTORY_ICONS.ITERATING} Iterating...`,
  CI_PASSED: `${HISTORY_ICONS.CI_PASSED} CI Passed`,
  CI_FAILED: `${HISTORY_ICONS.CI_FAILED} CI Failed`,
  REVIEW_REQUESTED: `${HISTORY_ICONS.REVIEW_REQUESTED} Review requested`,

  // Orchestration
  ALL_PHASES_COMPLETE: `${HISTORY_ICONS.CI_PASSED} All phases complete`,
  MERGED: `${HISTORY_ICONS.MERGED} Merged`,

  // Merge queue
  ENTERED_QUEUE: `${HISTORY_ICONS.INITIALIZED} Entered queue`,
  REMOVED_FROM_QUEUE: `${HISTORY_ICONS.CI_FAILED} Removed from queue`,

  // Deployment
  DEPLOYED_STAGE: `${HISTORY_ICONS.CI_PASSED} Deployed to stage`,
  RELEASED_PROD: `${HISTORY_ICONS.CI_PASSED} Released to production`,
  STAGE_DEPLOY_FAILED: `${HISTORY_ICONS.CI_FAILED} Stage deploy failed`,
  PROD_DEPLOY_FAILED: `${HISTORY_ICONS.CI_FAILED} Prod deploy failed`,

  // Push to draft
  CODE_PUSHED: `${HISTORY_ICONS.CODE_PUSHED} Code pushed - converting to draft`,

  // Grooming
  GROOMING: `${HISTORY_ICONS.ITERATING} grooming...`,
  ANALYZING_PIVOT: `${HISTORY_ICONS.ITERATING} Analyzing pivot request...`,

  // Invalid iteration
  INVALID_ITERATION: `${HISTORY_ICONS.CI_FAILED} FATAL: Cannot iterate on parent issue without sub-issues. Only sub-issues can be iterated on directly. Run grooming to create sub-issues first.`,

  // Verification (for future sm-verify)
  VERIFICATION_FAILED: `${HISTORY_ICONS.CI_FAILED} Verification failed`,

  // Dynamic builders
  initialized: (phaseCount: number) =>
    `${HISTORY_ICONS.INITIALIZED} Initialized with ${phaseCount} phase(s)`,
  phaseStarted: (phase: number) =>
    `${HISTORY_ICONS.PHASE_ADVANCED} Phase ${phase} started`,
  blocked: (failures: number) =>
    `${HISTORY_ICONS.BLOCKED} Blocked: Max failures reached (${failures})`,
  agentBlocked: (reason: string) =>
    `${HISTORY_ICONS.BLOCKED} Blocked: Agent reported blocked - ${reason}`,
  RETRY: `${HISTORY_ICONS.INITIALIZED} Retried: Failures cleared, resuming work`,
} as const;

// ============================================================================
// Section Names
// ============================================================================

/** Both singular and plural forms, for findHeadingIndexAny */
const TODO_ALIASES: readonly string[] = ["Todo", "Todos"];

/**
 * Canonical heading names for all issue body sections used by this state machine.
 */
export const SECTION_NAMES = {
  DESCRIPTION: "Description",
  REQUIREMENTS: "Requirements",
  APPROACH: "Approach",
  ACCEPTANCE_CRITERIA: "Acceptance Criteria",
  TESTING: "Testing",
  RELATED: "Related",
  QUESTIONS: "Questions",
  TODOS: "Todos",
  AGENT_NOTES: "Agent Notes",
  ITERATION_HISTORY: "Iteration History",
  AFFECTED_AREAS: "Affected Areas",
  TODO_ALIASES,
} as const;

// ============================================================================
// Standard Section Order
// ============================================================================

/**
 * Canonical ordering for section insertion.
 * Used by upsertSection to determine where to insert new sections.
 */
export const STANDARD_SECTION_ORDER: readonly string[] = [
  SECTION_NAMES.DESCRIPTION,
  SECTION_NAMES.REQUIREMENTS,
  SECTION_NAMES.APPROACH,
  SECTION_NAMES.ACCEPTANCE_CRITERIA,
  SECTION_NAMES.TESTING,
  SECTION_NAMES.RELATED,
  SECTION_NAMES.QUESTIONS,
  SECTION_NAMES.TODOS,
  SECTION_NAMES.AGENT_NOTES,
  SECTION_NAMES.ITERATION_HISTORY,
];

// ============================================================================
// Body Structure Schemas
// ============================================================================

/**
 * Question statistics schema (mirrors QuestionStatsSchema from extractors).
 * Re-declared here to avoid circular dependency with parser/extractors.
 */
export const QuestionStatsSchemaForBody = z.object({
  total: z.number(),
  answered: z.number(),
  unanswered: z.number(),
});

/**
 * Schema for the extracted domain structure of a sub-issue body.
 * Composes generic schemas from @more/issue-state.
 */
export const SubIssueBodyStructureSchema = z.object({
  // Section existence flags
  hasDescription: z.boolean(),
  hasTodos: z.boolean(),
  hasHistory: z.boolean(),
  hasAgentNotes: z.boolean(),
  hasQuestions: z.boolean(),
  hasAffectedAreas: z.boolean(),

  // Extracted data
  todoStats: TodoStatsSchema.nullable(),
  questionStats: QuestionStatsSchemaForBody.nullable(),
  historyEntries: z.array(HistoryEntrySchema),
  agentNotesEntries: z.array(AgentNotesEntrySchema),
});

export type SubIssueBodyStructure = z.infer<typeof SubIssueBodyStructureSchema>;

/**
 * Schema for the extracted domain structure of a parent issue body.
 * Extends sub-issue structure with parent-only section flags.
 */
export const ParentIssueBodyStructureSchema =
  SubIssueBodyStructureSchema.extend({
    hasRequirements: z.boolean(),
    hasApproach: z.boolean(),
    hasAcceptanceCriteria: z.boolean(),
    hasTesting: z.boolean(),
    hasRelated: z.boolean(),
  });

export type ParentIssueBodyStructure = z.infer<
  typeof ParentIssueBodyStructureSchema
>;
