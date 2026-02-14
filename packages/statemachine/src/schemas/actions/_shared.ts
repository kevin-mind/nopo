/**
 * Shared Action Infrastructure
 *
 * defAction builder, mkSchema, predict types, base schemas, and common helpers.
 */

import { z } from "zod";
import * as core from "@actions/core";
import * as fs from "fs";

import type {
  PredictableStateTree,
  PredictableIssueState,
  PredictableSubIssueState,
} from "../../verify/predictable-state.js";
import type { MachineContext } from "../state.js";
import type { RunnerContext, ActionChainContext } from "../../runner/types.js";
import type { OctokitLike } from "@more/issue-state";

// ============================================================================
// Predict Types
// ============================================================================

/**
 * The resolved target for an action's issueNumber.
 * Auto-resolved by the prediction fold when the action has an `issueNumber` field.
 * `undefined` for actions without `issueNumber` or when the number doesn't match.
 */
type ResolvedTarget =
  | PredictableIssueState
  | PredictableSubIssueState
  | undefined;

/**
 * Declarative diff returned by a predict function.
 *
 * - `target` — changes to the resolved target (issue or sub-issue matching issueNumber)
 * - `issue` — changes to the root issue (tree.issue)
 * - `subs` — changes to specific sub-issues by number
 */

export type PredictDiff = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deep partial with array ops is impractical to type precisely
  target?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deep partial with array ops is impractical to type precisely
  issue?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deep partial with array ops is impractical to type precisely
  subs?: Array<{ number: number } & Record<string, any>>;
};

/**
 * Context passed to predict functions.
 */
export interface PredictContext {
  tree: PredictableStateTree;
  machineContext: MachineContext;
}

/**
 * Predict function signature.
 * Returns a single diff (deterministic) or array of diffs (forking/AI-dependent).
 */
type PredictFn = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- action type varies per definition
  action: any,
  target: ResolvedTarget,
  ctx: PredictContext,
) => PredictDiff | PredictDiff[];

// ============================================================================
// Token & Base Schema
// ============================================================================

const TokenTypeSchema = z.enum(["code", "review"]);

export type TokenType = z.infer<typeof TokenTypeSchema>;

const ArtifactSchema = z.object({
  /** Unique name for the artifact (used for upload/download matching) */
  name: z.string(),
  /** Path to the file (relative to workspace) */
  path: z.string(),
});

export { ArtifactSchema };

const BaseActionSchema = z.object({
  id: z.string().uuid().optional(),
  /** Which token to use for this action (defaults to 'code') */
  token: TokenTypeSchema.default("code"),
  /** Artifact this action produces (will be uploaded after execution) */
  producesArtifact: ArtifactSchema.optional(),
  /** Artifact this action consumes (will be downloaded before execution) */
  consumesArtifact: ArtifactSchema.optional(),
});

// ============================================================================
// Action Execute Function Type
// ============================================================================

/**
 * Unified executor signature for action definitions.
 * All executors conform to this shape; the `action` param is `any` because
 * each definition narrows it via its own schema.
 */
type ActionExecuteFn = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- action type varies per definition
  action: any,
  ctx: RunnerContext,
  chainCtx?: ActionChainContext,
) => Promise<unknown>;

// ============================================================================
// Sub-schemas used by action definitions
// ============================================================================

/**
 * Phase definition for creating sub-issues
 */
export const PhaseDefinitionSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
});

/**
 * Research thread definition for parallel investigation
 */
export const ResearchThreadSchema = z.object({
  commentNodeId: z.string().min(1),
  title: z.string().min(1),
  question: z.string().min(1),
  investigationAreas: z.array(z.string()),
  expectedDeliverables: z.array(z.string()),
});

export type ResearchThread = z.infer<typeof ResearchThreadSchema>;

/**
 * Grooming agent type for parallel execution
 */
export const GroomingAgentTypeSchema = z.enum([
  "pm",
  "engineer",
  "qa",
  "research",
]);

export type GroomingAgentType = z.infer<typeof GroomingAgentTypeSchema>;

// ============================================================================
// mkSchema + defAction
// ============================================================================

/**
 * Helper to build a full action schema from type literal + custom fields.
 */
export function mkSchema<T extends string, F extends z.ZodRawShape>(
  type: T,
  fields: F,
) {
  return BaseActionSchema.extend({ type: z.literal(type) }).extend(fields);
}

/**
 * Build an action definition from a pre-built schema + predict + execute.
 *
 * `create()` produces an action instance with `execute` attached as a
 * non-enumerable property (invisible to JSON.stringify). The runner can call
 * `action.execute(ctx, chainCtx)` directly.
 */
export function defAction<S extends z.ZodObject<z.ZodRawShape>>(
  schema: S,
  config: {
    predict?: PredictFn;
    execute: ActionExecuteFn;
  },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions -- extracting type literal value from schema internals
  const type: string = (schema.shape.type as any)._def.value;

  function create(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- params shape varies per action; validated by schema at the runner boundary
    params: any,
  ) {
    const action = { token: "code", ...params, type };
    Object.defineProperty(action, "execute", {
      value: (ctx: RunnerContext, chainCtx?: ActionChainContext) =>
        config.execute(action, ctx, chainCtx),
      enumerable: false,
    });
    return action;
  }

  return { schema, predict: config.predict, execute: config.execute, create };
}

// ============================================================================
// Common Helpers
// ============================================================================

/**
 * Cast RunnerContext octokit to @more/issue-state OctokitLike
 */
export function asOctokitLike(ctx: RunnerContext): OctokitLike {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- compatible types
  return ctx.octokit as unknown as OctokitLike;
}

/**
 * Get structured output from chain context or file.
 *
 * For matrix job execution where actions run in separate jobs,
 * the structured output is passed through artifacts. This function
 * reads from the file if chain context doesn't have the output.
 */
export function getStructuredOutput(
  action: { filePath?: string },
  chainCtx?: ActionChainContext,
): unknown | undefined {
  // First try chain context (same-job execution)
  if (chainCtx?.lastClaudeStructuredOutput) {
    core.info("Using structured output from chain context");
    return chainCtx.lastClaudeStructuredOutput;
  }

  // Check if action has a filePath for artifact-based execution
  if (action.filePath) {
    core.info(`Checking for structured output file: ${action.filePath}`);
    core.info(`Current working directory: ${process.cwd()}`);

    // List files in current directory for debugging
    try {
      const files = fs.readdirSync(".");
      core.info(`Files in cwd: ${files.slice(0, 20).join(", ")}`);
    } catch (e) {
      core.warning(`Failed to list files: ${e}`);
    }

    if (fs.existsSync(action.filePath)) {
      try {
        const content = fs.readFileSync(action.filePath, "utf-8");
        const parsed = JSON.parse(content);
        core.info(`Loaded structured output from file: ${action.filePath}`);
        return parsed;
      } catch (e) {
        core.warning(
          `Failed to read structured output from ${action.filePath}: ${e}`,
        );
      }
    } else {
      core.warning(`File not found: ${action.filePath}`);
    }
  }

  return undefined;
}
