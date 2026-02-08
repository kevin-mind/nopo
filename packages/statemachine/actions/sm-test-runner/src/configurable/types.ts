/**
 * Types for Configurable Test Runner
 *
 * This module defines the schemas for state-based fixture testing where:
 * - Each fixture file represents a state in the state machine
 * - File ordering (01-iterating.json, 02-processingCI.json) defines the flow
 * - The expected state of step N is the fixture for step N+1
 */

import { z } from "zod";
import { CIResultSchema, IssueTriggerTypeSchema } from "@more/statemachine";

// ============================================================================
// State Names - All distinct states in the state machine
// ============================================================================

const StateNameSchema = z.enum([
  // Transient states (routing decisions)
  "detecting",
  "initializing",
  "orchestrating",
  "processingCI",
  "processingReview",
  "processingMerge",
  "transitioningToReview",

  // Final states (work is done or stopped)
  "triaging",
  "grooming",
  "resetting",
  "commenting",
  "pivoting",
  "prReviewing",
  "prResponding",
  "prRespondingHuman",
  "prPush",
  "orchestrationRunning",
  "orchestrationWaiting",
  "orchestrationComplete",
  "awaitingMerge",
  "iterating",
  "iteratingFix",
  "reviewing",
  "blocked",
  "error",
  "invalidIteration",
  "done",

  // Logging states
  "mergeQueueLogging",
  "mergeQueueFailureLogging",
  "mergedLogging",
  "deployedStageLogging",
  "deployedProdLogging",
]);

export type StateName = z.infer<typeof StateNameSchema>;

// ============================================================================
// Claude Mock Schema
// ============================================================================

/**
 * Mock output for a specific Claude prompt type
 * Referenced from StateFixture via claudeMock field
 */
export const ClaudeMockSchema = z.object({
  /** Optional description of what this mock represents */
  description: z.string().optional(),
  /** The structured output to return when this mock is used */
  output: z.record(z.unknown()),
});

export type ClaudeMock = z.infer<typeof ClaudeMockSchema>;

// ============================================================================
// Test-Specific Schemas (allow placeholder values)
// ============================================================================

/**
 * Test sub-issue schema for fixtures
 * Simplified version for test setup
 */
const TestSubIssueSchema = z.object({
  number: z.number().int().nonnegative(), // 0 = placeholder
  title: z.string(),
  body: z.string(),
  state: z.enum(["OPEN", "CLOSED"]),
  projectStatus: z.string().nullable(),
  branch: z.string().nullable().optional(),
  pr: z
    .object({
      number: z.number().int().nonnegative(), // 0 = placeholder
      state: z.enum(["OPEN", "CLOSED", "MERGED"]),
      isDraft: z.boolean(),
      title: z.string(),
      headRef: z.string(),
      baseRef: z.string(),
    })
    .nullable()
    .optional(),
  todos: z
    .object({
      total: z.number().int().nonnegative(),
      completed: z.number().int().nonnegative(),
      uncheckedNonManual: z.number().int().nonnegative(),
    })
    .optional(),
});

export type TestSubIssue = z.infer<typeof TestSubIssueSchema>;

/**
 * Test PR schema for fixtures
 * Describes the PR state needed for the test
 */
const TestPRSchema = z.object({
  number: z.number().int().nonnegative(), // 0 = create new PR
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  title: z.string(),
  body: z.string().optional(),
  headRef: z.string().optional(), // Branch name (will use test branch if not specified)
  baseRef: z.string().default("main"),
});

export type TestPR = z.infer<typeof TestPRSchema>;

/**
 * ParentIssue schema modified for test fixtures
 * Allows number: 0 as a placeholder (replaced with real issue number at runtime)
 */
const TestParentIssueSchema = z.object({
  number: z.number().int().nonnegative(), // Allow 0 as placeholder
  title: z.string(),
  state: z.enum(["OPEN", "CLOSED"]),
  body: z.string(),
  projectStatus: z.string().nullable(),
  iteration: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  assignees: z.array(z.string()),
  labels: z.array(z.string()),
  subIssues: z.array(TestSubIssueSchema), // Now typed for test fixtures
  hasSubIssues: z.boolean(),
  history: z.array(z.unknown()), // Simplified for fixtures
  todos: z.object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    uncheckedNonManual: z.number().int().nonnegative(),
  }),
  /** PR linked to this issue (optional, for states that need a PR) */
  pr: TestPRSchema.nullable().optional(),
});

// ============================================================================
// State Fixture Schema
// ============================================================================

/**
 * State fixture - represents state at entry to a state machine state
 * Uses a test-specific ParentIssue schema that allows placeholder values
 */
/**
 * Comment fixture schema for comment/pivot scenarios
 */
const TestCommentSchema = z.object({
  id: z.number().int().nonnegative(), // 0 = placeholder
  body: z.string(),
  author: z.string(),
});

export const StateFixtureSchema = z.object({
  /** The state name this fixture represents */
  state: StateNameSchema,

  /** Optional description of this fixture state */
  description: z.string().optional(),

  /** Explicit trigger type to use (optional, overrides auto-detection) */
  trigger: IssueTriggerTypeSchema.optional(),

  /** CI result to inject for this transition (optional) */
  ciResult: CIResultSchema.optional(),

  /** Review decision to inject for this transition (optional) */
  reviewDecision: z
    .enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"])
    .optional(),

  /** Issue state - uses test-specific schema allowing placeholder values */
  issue: TestParentIssueSchema,

  /** Comment that triggered this state (for comment/pivot scenarios) */
  comment: TestCommentSchema.optional(),

  /** Pivot description from /pivot command (for pivot scenarios) */
  pivotDescription: z.string().optional(),

  /**
   * Parent issue for sub-issue scenarios.
   * If provided, the fixture's `issue` is treated as a sub-issue.
   * This is REQUIRED for iteration states - only sub-issues can iterate.
   */
  parentIssue: z
    .object({
      number: z.number().int().nonnegative(), // 0 = placeholder
      title: z.string(),
      state: z.enum(["OPEN", "CLOSED"]),
      body: z.string(),
      projectStatus: z.string().nullable(),
      iteration: z.number().int().nonnegative(),
      failures: z.number().int().nonnegative(),
    })
    .optional(),

  /** Reference to a claude mock file (when mock_claude=true) */
  claudeMock: z.string().optional(),

  /** Multiple claude mock references (for states that call multiple Claude prompts, like grooming) */
  claudeMocks: z.array(z.string()).optional(),

  /** Expected results for this state transition (optional, for validation) */
  expected: z.record(z.unknown()).optional(),
});

export type StateFixture = z.infer<typeof StateFixtureSchema>;

// ============================================================================
// Scenario Schema
// ============================================================================

/**
 * Scenario configuration - metadata only
 * Ordering comes from file prefixes (01-, 02-, etc.)
 */
export const ScenarioConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
});

// Type inferred but kept for documentation
type _ScenarioConfig = z.infer<typeof ScenarioConfigSchema>;
void (0 as unknown as _ScenarioConfig); // Suppress unused type warning

// ============================================================================
// Test Runner Inputs Schema
// ============================================================================

/**
 * Inputs for the configurable test runner
 */
const _TestRunnerInputsSchema = z.object({
  /** false = stop after one step, true = run to completion */
  continue: z.boolean().default(true),

  /** Start at a specific state name (e.g., "iteratingFix") */
  startStep: z.string().optional(),

  /** true = use fixture outputs, false = run real Claude */
  mockClaude: z.boolean().default(true),

  /** true = CI passes/fails immediately, false = run real CI */
  mockCI: z.boolean().default(true),

  /** true = include all tasks (multi sub-issues), false = pick one random task */
  multiIssue: z.boolean().default(true),
});

export type TestRunnerInputs = z.infer<typeof _TestRunnerInputsSchema>;

// ============================================================================
// Test Result Schema
// ============================================================================

/**
 * Result of a single state transition
 */
const StateTransitionResultSchema = z.object({
  /** Starting state */
  fromState: StateNameSchema,
  /** Ending state */
  toState: StateNameSchema,
  /** Whether the transition succeeded */
  success: z.boolean(),
  /** Error message if failed */
  error: z.string().optional(),
  /** Duration in milliseconds */
  durationMs: z.number(),
  /** Verification failures if any */
  verificationErrors: z.array(z.string()).optional(),
});

export type StateTransitionResult = z.infer<typeof StateTransitionResultSchema>;

/**
 * Overall test result
 */
const _TestResultSchema = z.object({
  /** Overall status */
  status: z.enum(["completed", "paused", "failed", "error"]),
  /** Current state (if paused) */
  currentState: StateNameSchema.optional(),
  /** Next state (if paused) */
  nextState: StateNameSchema.optional(),
  /** Issue number used for test */
  issueNumber: z.number(),
  /** All state transitions executed */
  transitions: z.array(StateTransitionResultSchema),
  /** Total duration in milliseconds */
  totalDurationMs: z.number(),
  /** Error message if status is error */
  error: z.string().optional(),
});

export type TestResult = z.infer<typeof _TestResultSchema>;

// ============================================================================
// Loaded Scenario
// ============================================================================

/**
 * A fully loaded scenario ready for execution
 */
export interface LoadedScenario {
  /** Scenario name */
  name: string;
  /** Scenario description */
  description: string;
  /** State names in order (derived from file prefixes) */
  orderedStates: StateName[];
  /** Fixtures by state name */
  fixtures: Map<StateName, StateFixture>;
  /** Claude mocks by reference (e.g., "iterate/broken-code") */
  claudeMocks: Map<string, ClaudeMock>;
}
