import { describe, test, expect } from "vitest";
import { createActor } from "xstate";
import { discussionMachine } from "../../machine/machine.js";
import type { DiscussionContext } from "../../schemas/index.js";
import {
  createContext,
  createNewDiscussionContext,
  createHumanCommentContext,
  createBotCommentContext,
  createBotResearchThreadContext,
  createCommandContext,
  createSummarizeCommandContext,
  createPlanCommandContext,
  createCompleteCommandContext,
} from "../fixtures/index.js";

// Helper to run the machine and get final state
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

      // Should go through commanding to summarizing
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
        expect(runClaudeAction.promptDir).toBe("respond");
        expect(runClaudeAction.promptVars.COMMENT_BODY).toBe("Can you explain how authentication works?");
        expect(runClaudeAction.promptVars.COMMENT_AUTHOR).toBe("developer123");
      }
    });

    /**
     * Note: Bot comment handling has changed. The state machine now trusts
     * detect-event's routing decision. Bot reply comments are filtered by
     * detect-event (returns skip=true), so they never reach the state machine.
     *
     * Bot research threads that DO reach the state machine should be investigated.
     * See "Bot research thread investigation" tests below.
     */
    test("responds to all discussion comments that reach the state machine", () => {
      // If a bot comment reaches the state machine, it's because detect-event
      // decided it needs a response (e.g., research thread investigation)
      const context = createBotCommentContext("nopo-bot");
      const { state, actions } = runMachine(context);

      expect(state).toBe("responding");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("runClaude");
    });
  });

  describe("Bot research thread investigation", () => {
    /**
     * Bot research threads should trigger investigation.
     *
     * The flow is:
     * 1. Discussion created -> research prompt creates research threads
     * 2. Each research thread (bot comment with "## 🔍 Research:") triggers investigation
     * 3. Bot investigates and responds to its own research thread
     *
     * detect-event routes bot research threads to discussion-respond with trigger
     * "discussion-comment". The state machine now trusts this decision and responds
     * to all discussion comments that reach it (bot reply comments are already
     * filtered by detect-event returning skip=true).
     */
    test("investigates bot research threads", () => {
      const context = createBotResearchThreadContext();
      const { state, actions } = runMachine(context);

      // Bot research threads should respond (investigate)
      expect(state).toBe("responding");
      const actionTypes = actions.map((a) => a.type);
      expect(actionTypes).toContain("runClaude");
      expect(actionTypes).toContain("applyDiscussionRespondOutput");
    });

    test("bot research threads include comment context in runClaude action", () => {
      const context = createBotResearchThreadContext({
        discussion: {
          commentBody: "## 🔍 Research: Authentication Flow\n\nQuestions:\n1. How does auth work?",
          commentAuthor: "claude[bot]",
        },
      });
      const { actions } = runMachine(context);

      const runClaudeAction = actions.find((a) => a.type === "runClaude");
      expect(runClaudeAction).toBeDefined();
      if (runClaudeAction?.type === "runClaude") {
        expect(runClaudeAction.promptVars.COMMENT_BODY).toContain("Authentication Flow");
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
        expect(runClaudeAction.promptDir).toBe("summarize");
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
        expect(runClaudeAction.promptDir).toBe("plan");
      }
    });

    test("transitions to completing for /complete command", () => {
      const context = createCompleteCommandContext();
      const { state, actions } = runMachine(context);

      expect(state).toBe("completing");
      const actionTypes = actions.map((a) => a.type);
      // Complete doesn't need Claude - it just adds reaction and comment
      expect(actionTypes).not.toContain("runClaude");
      expect(actionTypes).toContain("addDiscussionReaction");
      expect(actionTypes).toContain("addDiscussionComment");
    });

    test("skips unknown commands", () => {
      const context = createContext({
        trigger: "discussion-command",
        discussion: {
          command: undefined, // No command
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

      // Should have log, runClaude, and applyDiscussionResearchOutput
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

      // Still transitions to researching (creates new threads)
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

      // Even with missing fields, discussion-comment triggers respond
      // The respond action will handle missing fields gracefully (using defaults)
      expect(state).toBe("responding");

      // runClaude should still be emitted with empty/default values
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
