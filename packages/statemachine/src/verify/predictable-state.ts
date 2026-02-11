/**
 * Predictable State Tree
 *
 * Schemas and extraction for the verifiable state of an issue tree.
 * A PredictableStateTree captures the structural state of a parent issue
 * and all its sub-issues in a form that can be predicted before execution
 * and compared against actual state after execution.
 */

import { z } from "zod";
import {
  IssueStateSchema,
  ProjectStatusSchema,
  PRStateSchema,
  type IssueData,
  type SubIssueData,
} from "@more/issue-state";
import type { MachineContext } from "../schemas/state.js";
import type { TriggerType } from "../schemas/state.js";
import {
  SubIssueBodyStructureSchema,
  ParentIssueBodyStructureSchema,
} from "../constants.js";
import {
  extractSubIssueBodyStructure,
  extractParentIssueBodyStructure,
} from "../parser/extractors.js";

// ============================================================================
// Predictable PR State
// ============================================================================

export const PredictablePRStateSchema = z.object({
  isDraft: z.boolean(),
  state: PRStateSchema,
});

export type PredictablePRState = z.infer<typeof PredictablePRStateSchema>;

// ============================================================================
// Predictable Sub-Issue State
// ============================================================================

export const PredictableSubIssueStateSchema = z.object({
  number: z.number().int().positive(),
  state: IssueStateSchema,
  projectStatus: ProjectStatusSchema.nullable(),
  labels: z.array(z.string()),
  hasBranch: z.boolean(),
  hasPR: z.boolean(),
  pr: PredictablePRStateSchema.nullable(),
  body: SubIssueBodyStructureSchema,
});

export type PredictableSubIssueState = z.infer<
  typeof PredictableSubIssueStateSchema
>;

// ============================================================================
// Predictable Issue State (root/parent)
// ============================================================================

export const PredictableIssueStateSchema = z.object({
  number: z.number().int().positive(),
  state: IssueStateSchema,
  projectStatus: ProjectStatusSchema.nullable(),
  iteration: z.number().int().min(0),
  failures: z.number().int().min(0),
  labels: z.array(z.string()),
  assignees: z.array(z.string()),
  hasBranch: z.boolean(),
  hasPR: z.boolean(),
  pr: PredictablePRStateSchema.nullable(),
  body: ParentIssueBodyStructureSchema,
});

export type PredictableIssueState = z.infer<typeof PredictableIssueStateSchema>;

// ============================================================================
// Predictable State Tree
// ============================================================================

export const PredictableStateTreeSchema = z.object({
  issue: PredictableIssueStateSchema,
  subIssues: z.array(PredictableSubIssueStateSchema),
});

export type PredictableStateTree = z.infer<typeof PredictableStateTreeSchema>;

// ============================================================================
// Expected State (wraps outcomes with metadata)
// ============================================================================

export const ExpectedStateSchema = z.object({
  finalState: z.string(),
  outcomes: z.array(PredictableStateTreeSchema),
  timestamp: z.string(),
  trigger: z.string(),
  issueNumber: z.number().int().positive(),
  parentIssueNumber: z.number().int().positive().nullable(),
});

export type ExpectedState = z.infer<typeof ExpectedStateSchema>;

// ============================================================================
// Extraction
// ============================================================================

/**
 * Extract a PredictablePRState from a LinkedPR.
 */
function extractPRState(
  pr: { isDraft: boolean; state: string } | null,
): PredictablePRState | null {
  if (!pr) return null;
  return PredictablePRStateSchema.parse({
    isDraft: pr.isDraft,
    state: pr.state,
  });
}

/**
 * Extract a PredictableSubIssueState from a SubIssueData.
 */
function extractSubIssueState(sub: SubIssueData): PredictableSubIssueState {
  return PredictableSubIssueStateSchema.parse({
    number: sub.number,
    state: sub.state,
    projectStatus: sub.projectStatus,
    labels: sub.labels,
    hasBranch: sub.branch !== null,
    hasPR: sub.pr !== null,
    pr: extractPRState(sub.pr),
    body: extractSubIssueBodyStructure(sub.bodyAst),
  });
}

/**
 * Extract a PredictableIssueState from an IssueData.
 */
function extractIssueState(issue: IssueData): PredictableIssueState {
  return PredictableIssueStateSchema.parse({
    number: issue.number,
    state: issue.state,
    projectStatus: issue.projectStatus,
    iteration: issue.iteration,
    failures: issue.failures,
    labels: issue.labels,
    assignees: issue.assignees,
    hasBranch: issue.branch !== null,
    hasPR: issue.pr !== null,
    pr: extractPRState(issue.pr),
    body: extractParentIssueBodyStructure(issue.bodyAst),
  });
}

/**
 * Extract a PredictableStateTree from a MachineContext.
 *
 * Determines the root issue and sub-issues:
 * - If the context has a parentIssue, the parent is root and the current
 *   issue's sub-issues (from the parent) are used.
 * - If no parent, the current issue is root with its own subIssues.
 */
export function extractPredictableTree(
  context: MachineContext,
): PredictableStateTree {
  if (context.parentIssue) {
    // Current issue is a sub-issue; parent is root
    const root = extractIssueState(context.parentIssue);
    const subIssues = context.parentIssue.subIssues.map(extractSubIssueState);
    return { issue: root, subIssues };
  }

  // Current issue is root
  const root = extractIssueState(context.issue);
  const subIssues = context.issue.subIssues.map(extractSubIssueState);
  return { issue: root, subIssues };
}

/**
 * Build an ExpectedState object from a derive result and predicted outcomes.
 */
export function buildExpectedState(options: {
  finalState: string;
  outcomes: PredictableStateTree[];
  trigger: TriggerType;
  issueNumber: number;
  parentIssueNumber: number | null;
}): ExpectedState {
  return ExpectedStateSchema.parse({
    finalState: options.finalState,
    outcomes: options.outcomes,
    timestamp: new Date().toISOString(),
    trigger: options.trigger,
    issueNumber: options.issueNumber,
    parentIssueNumber: options.parentIssueNumber,
  });
}
