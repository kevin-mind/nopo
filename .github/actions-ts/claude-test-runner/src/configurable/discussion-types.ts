/**
 * Types for Discussion Configurable Test Runner
 *
 * This module defines schemas for discussion state-based fixture testing where:
 * - Each fixture file represents a state in the discussion state machine
 * - File ordering (01-researching.json, 02-done.json) defines the flow
 * - The expected state is verified after machine execution
 */

import { z } from "zod";

// ============================================================================
// Discussion State Names - All distinct states in the discussion state machine
// ============================================================================

const DiscussionStateNameSchema = z.enum([
  // Transient states (routing decisions)
  "detecting",
  "commanding",

  // Final states (work is done or skipped)
  "researching",
  "responding",
  "summarizing",
  "planning",
  "completing",
  "skipped",
  "noContext",
]);

export type DiscussionStateName = z.infer<typeof DiscussionStateNameSchema>;

// ============================================================================
// Discussion Claude Mock Schema
// ============================================================================

/**
 * Mock output for a specific Claude prompt type
 * Referenced from StateFixture via claudeMock field
 */
export const DiscussionClaudeMockSchema = z.object({
  /** Optional description of what this mock represents */
  description: z.string().optional(),
  /** The structured output to return when this mock is used */
  output: z.record(z.unknown()),
});

export type DiscussionClaudeMock = z.infer<typeof DiscussionClaudeMockSchema>;

// ============================================================================
// Discussion Test Schemas
// ============================================================================

/**
 * Test discussion schema for fixtures
 */
const TestDiscussionSchema = z.object({
  number: z.number().int().nonnegative(), // 0 = placeholder
  nodeId: z.string(), // GraphQL node ID (can be placeholder)
  title: z.string(),
  body: z.string(),
  category: z.string().optional(),
  labels: z.array(z.string()).optional(),
  /** Comment info for comment-triggered scenarios */
  commentId: z.string().nullable().optional(),
  commentBody: z.string().nullable().optional(),
  commentAuthor: z.string().nullable().optional(),
  /** Command info for command-triggered scenarios */
  command: z.string().nullable().optional(),
});

type _TestDiscussion = z.infer<typeof TestDiscussionSchema>;

// ============================================================================
// Discussion State Fixture Schema
// ============================================================================

/**
 * Discussion state fixture - represents state at entry to a state machine state
 */
export const DiscussionStateFixtureSchema = z.object({
  /** The state name this fixture represents */
  state: DiscussionStateNameSchema,

  /** Trigger type for this fixture */
  trigger: z.enum([
    "discussion_created",
    "discussion_comment",
    "discussion_command",
  ]),

  /** Discussion state */
  discussion: TestDiscussionSchema,

  /** Reference to a claude mock file (when mock_claude=true) */
  claudeMock: z.string().optional(),

  /** Expected verification after execution */
  expected: z
    .object({
      /** Minimum number of comments expected on the discussion */
      minComments: z.number().int().nonnegative().optional(),
      /** Expected discussion body changes */
      bodyContains: z.array(z.string()).optional(),
      /** Expected issues created (for /plan command) */
      createdIssues: z
        .object({
          minCount: z.number().int().nonnegative(),
          requiredLabels: z.array(z.string()).optional(),
        })
        .optional(),
      /** Expected reaction on the comment */
      hasReaction: z.string().optional(),
    })
    .optional(),
});

export type DiscussionStateFixture = z.infer<
  typeof DiscussionStateFixtureSchema
>;

// ============================================================================
// Discussion Scenario Schema
// ============================================================================

/**
 * Discussion scenario configuration
 */
export const DiscussionScenarioConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** Category of discussion to create (e.g., "q-a", "ideas") */
  category: z.string().default("q-a"),
});

type _DiscussionScenarioConfig = z.infer<
  typeof DiscussionScenarioConfigSchema
>;

// ============================================================================
// Discussion Test Runner Inputs Schema
// ============================================================================

/**
 * Inputs for the discussion configurable test runner
 */
const _DiscussionTestRunnerInputsSchema = z.object({
  /** true = use fixture outputs, false = run real Claude */
  mockClaude: z.boolean().default(true),
});

export type DiscussionTestRunnerInputs = z.infer<
  typeof _DiscussionTestRunnerInputsSchema
>;

// ============================================================================
// Discussion Test Result Schema
// ============================================================================

/**
 * Result of a discussion state test
 */
const _DiscussionTestResultSchema = z.object({
  /** Overall status */
  status: z.enum(["completed", "failed", "error"]),
  /** Discussion number used for test */
  discussionNumber: z.number(),
  /** Final state after machine execution */
  finalState: DiscussionStateNameSchema,
  /** Actions that were executed */
  actionsExecuted: z.number(),
  /** Total duration in milliseconds */
  totalDurationMs: z.number(),
  /** Verification results */
  verificationErrors: z.array(z.string()).optional(),
  /** Error message if status is error */
  error: z.string().optional(),
});

export type DiscussionTestResult = z.infer<typeof _DiscussionTestResultSchema>;

// ============================================================================
// Loaded Discussion Scenario
// ============================================================================

/**
 * A fully loaded discussion scenario ready for execution
 */
export interface LoadedDiscussionScenario {
  /** Scenario name */
  name: string;
  /** Scenario description */
  description: string;
  /** Discussion category */
  category: string;
  /** State names in order (derived from file prefixes) */
  orderedStates: DiscussionStateName[];
  /** Fixtures by state name */
  fixtures: Map<DiscussionStateName, DiscussionStateFixture>;
  /** Claude mocks by reference (e.g., "discussion-research/basic") */
  claudeMocks: Map<string, DiscussionClaudeMock>;
}
