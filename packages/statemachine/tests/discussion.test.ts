import { describe, test, expect } from "vitest";
import { createActor } from "xstate";
import { discussionMachine } from "../src/discussion/machine.js";
import {
  createDiscussionContext,
  type DiscussionContext,
  type Discussion,
  type DiscussionCommand,
} from "../src/schemas/discussion-context.js";
import type { DiscussionTriggerType } from "../src/schemas/discussion-triggers.js";

// ============================================================================
// Test Fixtures
// ============================================================================

const DEFAULT_DISCUSSION: Discussion = {
  number: 1,
  nodeId: "D_kwDOTest123",
  title: "Test Discussion",
  body: "Test discussion body",
  commentCount: 0,
  researchThreads: [],
};

function createDiscussion(overrides: Partial<Discussion> = {}): Discussion {
  return {
    ...DEFAULT_DISCUSSION,
    ...overrides,
  };
}

function createContext(
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

function createNewDiscussionContext(
  overrides: Parameters<typeof createContext>[0] = {},
): DiscussionContext {
  return createContext({
    trigger: "discussion-created",
    ...overrides,
  });
}

function createHumanCommentContext(
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

function createBotCommentContext(
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

function createBotResearchThreadContext(
  overrides: Parameters<typeof createContext>[0] = {},
): DiscussionContext {
  return createContext({
    trigger: "discussion-comment",
    discussion: {
      commentId: "DC_kwDOTest_research",
      commentBody:
        "## 🔍 Research: Current Implementation\n\nQuestions to investigate:\n1. How does X work?\n2. What patterns are used?",
      commentAuthor: "claude[bot]",
      ...overrides.discussion,
    },
    ...overrides,
  });
}

function createCommandContext(
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

function createSummarizeCommandContext(
  overrides: Parameters<typeof createContext>[0] = {},
): DiscussionContext {
  return createCommandContext("summarize", overrides);
}

function createPlanCommandContext(
  overrides: Parameters<typeof createContext>[0] = {},
): DiscussionContext {
  return createCommandContext("plan", overrides);
}

function createCompleteCommandContext(
  overrides: Parameters<typeof createContext>[0] = {},
): DiscussionContext {
  return createCommandContext("complete", overrides);
}

// ============================================================================
// Test Helper
// ============================================================================

function runMachine(context: DiscussionContext) {
  const actor = createActor(discussionMachine, { input: context });
  actor.start();
  const snapshot = actor.getSnapshot();
  actor.stop();
  return {
    state: String(snapshot.value),
    actions: snapshot.context.pendingActions,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("discussionMachine", () => {
  describe("Initial state detection", () => {
    test("transitions to researching when discussion is created", () => {
      const context = createNewDiscussionContext();
      const { state, actions } = runMachine(context);

      expect(state).toBe("researching");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("log");
      expect(actionTypes).toContain("runClaude");
      expect(actionTypes).toContain("applyDiscussionResearchOutput");
    });

    test("transitions to responding when human comments", () => {
      const context = createHumanCommentContext();
      const { state, actions } = runMachine(context);

      expect(state).toBe("responding");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("log");
      expect(actionTypes).toContain("runClaude");
      expect(actionTypes).toContain("applyDiscussionRespondOutput");
    });

    test("transitions to commanding when command is triggered", () => {
      const context = createSummarizeCommandContext();
      const { state } = runMachine(context);

      expect(state).toBe("summarizing");
    });
  });

  describe("Human comment handling", () => {
    test("responds to human comment with respond prompt", () => {
      const context = createHumanCommentContext({
        discussion: {
          commentBody: "Can you explain how authentication works?",
          commentAuthor: "developer123",
        },
      });
      const { state, actions } = runMachine(context);

      expect(state).toBe("responding");

      const runClaudeAction = actions.find((a) => a.type === "runClaude");
      expect(runClaudeAction).toBeDefined();
      if (runClaudeAction?.type === "runClaude") {
        expect(runClaudeAction.promptDir).toBe("discussion/respond");
        expect(runClaudeAction.promptVars.COMMENT_BODY).toBe(
          "Can you explain how authentication works?",
        );
        expect(runClaudeAction.promptVars.COMMENT_AUTHOR).toBe("developer123");
      }
    });

    test("responds to all discussion comments that reach the state machine", () => {
      const context = createBotCommentContext("nopo-bot");
      const { state, actions } = runMachine(context);

      expect(state).toBe("responding");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("runClaude");
    });
  });

  describe("Bot research thread investigation", () => {
    test("investigates bot research threads", () => {
      const context = createBotResearchThreadContext();
      const { state, actions } = runMachine(context);

      expect(state).toBe("responding");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("runClaude");
      expect(actionTypes).toContain("applyDiscussionRespondOutput");
    });

    test("bot research threads include comment context in runClaude action", () => {
      const context = createBotResearchThreadContext({
        discussion: {
          commentBody:
            "## 🔍 Research: Authentication Flow\n\nQuestions:\n1. How does auth work?",
          commentAuthor: "claude[bot]",
        },
      });
      const { actions } = runMachine(context);

      const runClaudeAction = actions.find((a) => a.type === "runClaude");
      expect(runClaudeAction).toBeDefined();
      if (runClaudeAction?.type === "runClaude") {
        expect(runClaudeAction.promptVars.COMMENT_BODY).toContain(
          "Authentication Flow",
        );
        expect(runClaudeAction.promptVars.COMMENT_AUTHOR).toBe("claude[bot]");
      }
    });
  });

  describe("Command handling", () => {
    test("transitions to summarizing for /summarize command", () => {
      const context = createSummarizeCommandContext();
      const { state, actions } = runMachine(context);

      expect(state).toBe("summarizing");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("runClaude");
      expect(actionTypes).toContain("applyDiscussionSummarizeOutput");

      const runClaudeAction = actions.find((a) => a.type === "runClaude");
      if (runClaudeAction?.type === "runClaude") {
        expect(runClaudeAction.promptDir).toBe("discussion/summarize");
      }
    });

    test("transitions to planning for /plan command", () => {
      const context = createPlanCommandContext();
      const { state, actions } = runMachine(context);

      expect(state).toBe("planning");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("runClaude");
      expect(actionTypes).toContain("applyDiscussionPlanOutput");

      const runClaudeAction = actions.find((a) => a.type === "runClaude");
      if (runClaudeAction?.type === "runClaude") {
        expect(runClaudeAction.promptDir).toBe("discussion/plan");
      }
    });

    test("transitions to completing for /complete command", () => {
      const context = createCompleteCommandContext();
      const { state, actions } = runMachine(context);

      expect(state).toBe("completing");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).not.toContain("runClaude");
      expect(actionTypes).toContain("addDiscussionReaction");
      expect(actionTypes).toContain("addDiscussionComment");
    });

    test("skips unknown commands", () => {
      const context = createContext({
        trigger: "discussion-command",
        discussion: {
          command: undefined,
          commentId: "DC_test",
          commentBody: "/unknown",
          commentAuthor: "user",
        },
      });
      const { state } = runMachine(context);

      expect(state).toBe("skipped");
    });
  });

  describe("Action accumulation", () => {
    test("accumulates multiple actions during research", () => {
      const context = createNewDiscussionContext();
      const { actions } = runMachine(context);

      expect(actions.length).toBeGreaterThanOrEqual(3);

      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("log");
      expect(actionTypes).toContain("runClaude");
      expect(actionTypes).toContain("applyDiscussionResearchOutput");
    });

    test("includes discussion context in runClaude action", () => {
      const context = createNewDiscussionContext({
        discussion: {
          number: 42,
          title: "Test Title",
          body: "Test Body",
        },
      });
      const { actions } = runMachine(context);

      const runClaudeAction = actions.find((a) => a.type === "runClaude");
      expect(runClaudeAction).toBeDefined();
      if (runClaudeAction?.type === "runClaude") {
        expect(runClaudeAction.promptVars.DISCUSSION_NUMBER).toBe("42");
        expect(runClaudeAction.promptVars.DISCUSSION_TITLE).toBe("Test Title");
        expect(runClaudeAction.promptVars.DISCUSSION_BODY).toBe("Test Body");
      }
    });
  });

  describe("Edge cases", () => {
    test("handles empty discussion body", () => {
      const context = createNewDiscussionContext({
        discussion: {
          body: "",
        },
      });
      const { state } = runMachine(context);

      expect(state).toBe("researching");
    });

    test("handles discussion with existing research threads", () => {
      const context = createNewDiscussionContext({
        discussion: {
          researchThreads: [
            { nodeId: "DC_thread1", topic: "Topic 1", replyCount: 3 },
            { nodeId: "DC_thread2", topic: "Topic 2", replyCount: 0 },
          ],
        },
      });
      const { state } = runMachine(context);

      expect(state).toBe("researching");
    });

    test("handles missing comment fields gracefully", () => {
      const context = createContext({
        trigger: "discussion-comment",
        discussion: {
          commentId: undefined,
          commentBody: undefined,
          commentAuthor: undefined,
        },
      });
      const { state, actions } = runMachine(context);

      expect(state).toBe("responding");

      const runClaudeAction = actions.find((a) => a.type === "runClaude");
      expect(runClaudeAction).toBeDefined();
      if (runClaudeAction?.type === "runClaude") {
        expect(runClaudeAction.promptVars.COMMENT_ID).toBe("");
        expect(runClaudeAction.promptVars.COMMENT_BODY).toBe("");
        expect(runClaudeAction.promptVars.COMMENT_AUTHOR).toBe("");
      }
    });
  });
});
