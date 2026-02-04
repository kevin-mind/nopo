import { describe, test, expect } from "vitest";
import {
  triggeredByDiscussionCreated,
  triggeredByDiscussionComment,
  triggeredByDiscussionCommand,
  commandIsSummarize,
  commandIsPlan,
  commandIsComplete,
  isHumanComment,
  isBotResearchThread,
  hasDiscussionContext,
  hasComment,
} from "../../machine/guards.js";
import { createContext, createHumanCommentContext, createBotCommentContext } from "../fixtures/index.js";

describe("Discussion Guards", () => {
  describe("Trigger Guards", () => {
    test("triggeredByDiscussionCreated returns true for discussion-created", () => {
      const context = createContext({ trigger: "discussion-created" });
      expect(triggeredByDiscussionCreated({ context })).toBe(true);
    });

    test("triggeredByDiscussionCreated returns false for other triggers", () => {
      const context = createContext({ trigger: "discussion-comment" });
      expect(triggeredByDiscussionCreated({ context })).toBe(false);
    });

    test("triggeredByDiscussionComment returns true for discussion-comment", () => {
      const context = createContext({ trigger: "discussion-comment" });
      expect(triggeredByDiscussionComment({ context })).toBe(true);
    });

    test("triggeredByDiscussionComment returns false for other triggers", () => {
      const context = createContext({ trigger: "discussion-created" });
      expect(triggeredByDiscussionComment({ context })).toBe(false);
    });

    test("triggeredByDiscussionCommand returns true for discussion-command", () => {
      const context = createContext({ trigger: "discussion-command" });
      expect(triggeredByDiscussionCommand({ context })).toBe(true);
    });

    test("triggeredByDiscussionCommand returns false for other triggers", () => {
      const context = createContext({ trigger: "discussion-comment" });
      expect(triggeredByDiscussionCommand({ context })).toBe(false);
    });
  });

  describe("Command Guards", () => {
    test("commandIsSummarize returns true for summarize command", () => {
      const context = createContext({
        trigger: "discussion-command",
        discussion: { command: "summarize" },
      });
      expect(commandIsSummarize({ context })).toBe(true);
    });

    test("commandIsSummarize returns false for other commands", () => {
      const context = createContext({
        trigger: "discussion-command",
        discussion: { command: "plan" },
      });
      expect(commandIsSummarize({ context })).toBe(false);
    });

    test("commandIsPlan returns true for plan command", () => {
      const context = createContext({
        trigger: "discussion-command",
        discussion: { command: "plan" },
      });
      expect(commandIsPlan({ context })).toBe(true);
    });

    test("commandIsComplete returns true for complete command", () => {
      const context = createContext({
        trigger: "discussion-command",
        discussion: { command: "complete" },
      });
      expect(commandIsComplete({ context })).toBe(true);
    });
  });

  describe("Author Guards", () => {
    describe("isHumanComment", () => {
      test("returns true for human authors", () => {
        const context = createHumanCommentContext({
          discussion: { commentAuthor: "developer123" },
        });
        expect(isHumanComment({ context })).toBe(true);
      });

      test("returns false for nopo-bot", () => {
        const context = createBotCommentContext("nopo-bot");
        expect(isHumanComment({ context })).toBe(false);
      });

      test("returns false for claude[bot]", () => {
        const context = createHumanCommentContext({
          discussion: { commentAuthor: "claude[bot]" },
        });
        expect(isHumanComment({ context })).toBe(false);
      });

      test("returns false for any username ending in [bot]", () => {
        const context = createHumanCommentContext({
          discussion: { commentAuthor: "dependabot[bot]" },
        });
        expect(isHumanComment({ context })).toBe(false);
      });

      test("returns false when commentAuthor is undefined", () => {
        const context = createContext({
          trigger: "discussion-comment",
          discussion: { commentAuthor: undefined },
        });
        expect(isHumanComment({ context })).toBe(false);
      });

      test("returns false when commentAuthor is empty string", () => {
        const context = createContext({
          trigger: "discussion-comment",
          discussion: { commentAuthor: "" },
        });
        // Empty string is falsy, so should return false
        expect(isHumanComment({ context })).toBe(false);
      });
    });

    describe("isBotResearchThread", () => {
      test("returns true for nopo-bot comment on discussion-comment trigger", () => {
        const context = createBotCommentContext("nopo-bot");
        expect(isBotResearchThread({ context })).toBe(true);
      });

      test("returns true for claude[bot] comment on discussion-comment trigger", () => {
        const context = createHumanCommentContext({
          discussion: { commentAuthor: "claude[bot]" },
        });
        expect(isBotResearchThread({ context })).toBe(true);
      });

      test("returns false for human comments", () => {
        const context = createHumanCommentContext({
          discussion: { commentAuthor: "human-user" },
        });
        expect(isBotResearchThread({ context })).toBe(false);
      });

      test("returns false for bot comments on discussion-created trigger", () => {
        const context = createContext({
          trigger: "discussion-created",
          discussion: { commentAuthor: "nopo-bot" },
        });
        expect(isBotResearchThread({ context })).toBe(false);
      });

      test("returns false for bot comments on discussion-command trigger", () => {
        const context = createContext({
          trigger: "discussion-command",
          discussion: { commentAuthor: "nopo-bot", command: "summarize" },
        });
        expect(isBotResearchThread({ context })).toBe(false);
      });
    });

    describe("Bot detection edge cases", () => {
      test("custom bot username is detected", () => {
        const context = createContext({
          trigger: "discussion-comment",
          discussion: { commentAuthor: "custom-bot" },
          botUsername: "custom-bot",
        });
        expect(isHumanComment({ context })).toBe(false);
        expect(isBotResearchThread({ context })).toBe(true);
      });

      test("usernames similar to but not bot are treated as human", () => {
        const context = createHumanCommentContext({
          discussion: { commentAuthor: "not-a-bot-user" },
        });
        expect(isHumanComment({ context })).toBe(true);
      });

      test("usernames containing 'bot' but not ending in [bot] are human", () => {
        const context = createHumanCommentContext({
          discussion: { commentAuthor: "robotics-fan" },
        });
        expect(isHumanComment({ context })).toBe(true);
      });
    });
  });

  describe("State Guards", () => {
    test("hasDiscussionContext returns true when discussion exists", () => {
      const context = createContext();
      expect(hasDiscussionContext({ context })).toBe(true);
    });

    test("hasComment returns true when comment fields are present", () => {
      const context = createHumanCommentContext();
      expect(hasComment({ context })).toBe(true);
    });

    test("hasComment returns false when commentId is missing", () => {
      const context = createContext({
        trigger: "discussion-comment",
        discussion: {
          commentId: undefined,
          commentBody: "Some text",
        },
      });
      expect(hasComment({ context })).toBe(false);
    });

    test("hasComment returns false when commentBody is missing", () => {
      const context = createContext({
        trigger: "discussion-comment",
        discussion: {
          commentId: "DC_test",
          commentBody: undefined,
        },
      });
      expect(hasComment({ context })).toBe(false);
    });
  });
});

describe("Guard combinations for state transitions", () => {
  /**
   * These tests verify that guard combinations work correctly
   * for determining state transitions.
   */

  test("discussion-created trigger only matches triggeredByDiscussionCreated", () => {
    const context = createContext({ trigger: "discussion-created" });

    expect(triggeredByDiscussionCreated({ context })).toBe(true);
    expect(triggeredByDiscussionComment({ context })).toBe(false);
    expect(triggeredByDiscussionCommand({ context })).toBe(false);
  });

  test("human comment matches isHumanComment but not isBotResearchThread", () => {
    const context = createHumanCommentContext();

    expect(triggeredByDiscussionComment({ context })).toBe(true);
    expect(isHumanComment({ context })).toBe(true);
    expect(isBotResearchThread({ context })).toBe(false);
  });

  test("bot comment matches isBotResearchThread but not isHumanComment", () => {
    const context = createBotCommentContext("nopo-bot");

    expect(triggeredByDiscussionComment({ context })).toBe(true);
    expect(isHumanComment({ context })).toBe(false);
    expect(isBotResearchThread({ context })).toBe(true);
  });

  test("command trigger matches triggeredByDiscussionCommand", () => {
    const context = createContext({
      trigger: "discussion-command",
      discussion: { command: "summarize" },
    });

    expect(triggeredByDiscussionCommand({ context })).toBe(true);
    expect(commandIsSummarize({ context })).toBe(true);
    expect(commandIsPlan({ context })).toBe(false);
    expect(commandIsComplete({ context })).toBe(false);
  });
});
