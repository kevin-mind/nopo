/**
 * Test fixtures for discussion state machine tests
 */
import { createDiscussionContext } from "../../schemas/index.js";
import type {
  DiscussionContext,
  Discussion,
  DiscussionTriggerType,
  DiscussionCommand,
} from "../../schemas/index.js";

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_DISCUSSION: Discussion = {
  number: 1,
  nodeId: "D_kwDOTest123",
  title: "Test Discussion",
  body: "Test discussion body",
  commentCount: 0,
  researchThreads: [],
};

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a valid Discussion object
 */
export function createDiscussion(
  overrides: Partial<Discussion> = {},
): Discussion {
  return {
    ...DEFAULT_DISCUSSION,
    ...overrides,
  };
}

/**
 * Create a valid DiscussionContext for testing
 */
export function createContext(
  overrides: {
    trigger?: DiscussionTriggerType;
    owner?: string;
    repo?: string;
    discussion?: Partial<Discussion>;
    maxRetries?: number;
    botUsername?: string;
  } = {},
): DiscussionContext {
  const discussion = createDiscussion(overrides.discussion);

  return createDiscussionContext({
    trigger: overrides.trigger ?? "discussion-created",
    owner: overrides.owner ?? "test-owner",
    repo: overrides.repo ?? "test-repo",
    discussion,
    maxRetries: overrides.maxRetries ?? 5,
    botUsername: overrides.botUsername ?? "nopo-bot",
  });
}

// ============================================================================
// Scenario Fixtures
// ============================================================================

/**
 * Context for a new discussion creation
 */
export function createNewDiscussionContext(
  overrides: Parameters<typeof createContext>[0] = {},
): DiscussionContext {
  return createContext({
    trigger: "discussion-created",
    ...overrides,
  });
}

/**
 * Context for a human comment on a discussion
 */
export function createHumanCommentContext(
  overrides: Parameters<typeof createContext>[0] = {},
): DiscussionContext {
  return createContext({
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
 * Context for a bot comment on a discussion (e.g., research thread)
 */
export function createBotCommentContext(
  botUsername: string = "nopo-bot",
  overrides: Parameters<typeof createContext>[0] = {},
): DiscussionContext {
  return createContext({
    trigger: "discussion-comment",
    discussion: {
      commentId: "DC_kwDOTest789",
      commentBody: "## 🔍 Research: Topic\n\nInvestigating this topic...",
      commentAuthor: botUsername,
      ...overrides.discussion,
    },
    botUsername,
    ...overrides,
  });
}

/**
 * Context for a bot research thread that needs investigation
 * This is the scenario where bot creates a research thread that triggers investigation
 */
export function createBotResearchThreadContext(
  overrides: Parameters<typeof createContext>[0] = {},
): DiscussionContext {
  return createContext({
    trigger: "discussion-comment",
    discussion: {
      commentId: "DC_kwDOTest_research",
      commentBody: "## 🔍 Research: Current Implementation\n\nQuestions to investigate:\n1. How does X work?\n2. What patterns are used?",
      commentAuthor: "claude[bot]",
      ...overrides.discussion,
    },
    ...overrides,
  });
}

/**
 * Context for a discussion command
 */
export function createCommandContext(
  command: DiscussionCommand,
  overrides: Parameters<typeof createContext>[0] = {},
): DiscussionContext {
  return createContext({
    trigger: "discussion-command",
    discussion: {
      command,
      commentId: "DC_kwDOTest_cmd",
      commentBody: `/${command}`,
      commentAuthor: "human-user",
      ...overrides.discussion,
    },
    ...overrides,
  });
}

/**
 * Context for /summarize command
 */
export function createSummarizeCommandContext(
  overrides: Parameters<typeof createContext>[0] = {},
): DiscussionContext {
  return createCommandContext("summarize", overrides);
}

/**
 * Context for /plan command
 */
export function createPlanCommandContext(
  overrides: Parameters<typeof createContext>[0] = {},
): DiscussionContext {
  return createCommandContext("plan", overrides);
}

/**
 * Context for /complete command
 */
export function createCompleteCommandContext(
  overrides: Parameters<typeof createContext>[0] = {},
): DiscussionContext {
  return createCommandContext("complete", overrides);
}
