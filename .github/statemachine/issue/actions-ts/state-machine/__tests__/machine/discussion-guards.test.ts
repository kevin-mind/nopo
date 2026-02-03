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
} from "../../machine/discussion-guards.js";
import {
  createDiscussionContext,
  createNewDiscussionContext,
  createDiscussionCommentContext,
  createDiscussionCommandContext,
} from "../fixtures/index.js";

describe("Discussion Trigger Guards", () => {
  describe("triggeredByDiscussionCreated", () => {
    test("returns true for discussion_created trigger", () => {
      const context = createNewDiscussionContext();
      expect(triggeredByDiscussionCreated({ context })).toBe(true);
    });

    test("returns false for other triggers", () => {
      const context = createDiscussionCommentContext();
      expect(triggeredByDiscussionCreated({ context })).toBe(false);
    });
  });

  describe("triggeredByDiscussionComment", () => {
    test("returns true for discussion_comment trigger", () => {
      const context = createDiscussionCommentContext();
      expect(triggeredByDiscussionComment({ context })).toBe(true);
    });

    test("returns false for other triggers", () => {
      const context = createNewDiscussionContext();
      expect(triggeredByDiscussionComment({ context })).toBe(false);
    });
  });

  describe("triggeredByDiscussionCommand", () => {
    test("returns true for discussion_command trigger", () => {
      const context = createDiscussionCommandContext("summarize");
      expect(triggeredByDiscussionCommand({ context })).toBe(true);
    });

    test("returns false for other triggers", () => {
      const context = createNewDiscussionContext();
      expect(triggeredByDiscussionCommand({ context })).toBe(false);
    });
  });
});

describe("Discussion Command Guards", () => {
  describe("commandIsSummarize", () => {
    test("returns true when command is summarize", () => {
      const context = createDiscussionCommandContext("summarize");
      expect(commandIsSummarize({ context })).toBe(true);
    });

    test("returns false for other commands", () => {
      const context = createDiscussionCommandContext("plan");
      expect(commandIsSummarize({ context })).toBe(false);
    });
  });

  describe("commandIsPlan", () => {
    test("returns true when command is plan", () => {
      const context = createDiscussionCommandContext("plan");
      expect(commandIsPlan({ context })).toBe(true);
    });

    test("returns false for other commands", () => {
      const context = createDiscussionCommandContext("summarize");
      expect(commandIsPlan({ context })).toBe(false);
    });
  });

  describe("commandIsComplete", () => {
    test("returns true when command is complete", () => {
      const context = createDiscussionCommandContext("complete");
      expect(commandIsComplete({ context })).toBe(true);
    });

    test("returns false for other commands", () => {
      const context = createDiscussionCommandContext("summarize");
      expect(commandIsComplete({ context })).toBe(false);
    });
  });
});

describe("Discussion Author Guards", () => {
  describe("isHumanComment", () => {
    test("returns true for human author", () => {
      const context = createDiscussionCommentContext({
        discussion: {
          commentAuthor: "human-user",
        },
      });
      expect(isHumanComment({ context })).toBe(true);
    });

    test("returns false for bot author ending with [bot]", () => {
      const context = createDiscussionCommentContext({
        discussion: {
          commentAuthor: "github-actions[bot]",
        },
      });
      expect(isHumanComment({ context })).toBe(false);
    });

    test("returns false for nopo-bot", () => {
      const context = createDiscussionCommentContext({
        discussion: {
          commentAuthor: "nopo-bot",
        },
      });
      expect(isHumanComment({ context })).toBe(false);
    });

    test("returns false when no author", () => {
      const context = createDiscussionCommentContext({
        discussion: {
          commentAuthor: undefined,
        },
      });
      expect(isHumanComment({ context })).toBe(false);
    });
  });

  describe("isBotResearchThread", () => {
    test("returns true for nopo-bot comment on discussion_comment trigger", () => {
      const context = createDiscussionCommentContext({
        discussion: {
          commentAuthor: "nopo-bot",
        },
      });
      expect(isBotResearchThread({ context })).toBe(true);
    });

    test("returns true for bot account ending with [bot]", () => {
      const context = createDiscussionCommentContext({
        discussion: {
          commentAuthor: "github-actions[bot]",
        },
      });
      expect(isBotResearchThread({ context })).toBe(true);
    });

    test("returns false for human author", () => {
      const context = createDiscussionCommentContext({
        discussion: {
          commentAuthor: "human-user",
        },
      });
      expect(isBotResearchThread({ context })).toBe(false);
    });
  });
});

describe("Discussion State Guards", () => {
  describe("hasDiscussionContext", () => {
    test("returns true when discussion context exists", () => {
      const context = createNewDiscussionContext();
      expect(hasDiscussionContext({ context })).toBe(true);
    });

    test("returns false when discussion is null", () => {
      const context = createDiscussionContext();
      // Manually override discussion to null
      (context as { discussion: null }).discussion = null;
      expect(hasDiscussionContext({ context })).toBe(false);
    });
  });

  describe("hasComment", () => {
    test("returns true when comment ID and body exist", () => {
      const context = createDiscussionCommentContext();
      expect(hasComment({ context })).toBe(true);
    });

    test("returns false when no comment ID", () => {
      const context = createNewDiscussionContext();
      expect(hasComment({ context })).toBe(false);
    });
  });
});
