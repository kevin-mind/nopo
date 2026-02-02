import { describe, test, expect } from "vitest";
import { createActor } from "xstate";
import { discussionMachine } from "../../machine/discussion-machine.js";
import {
  createNewDiscussionContext,
  createDiscussionCommentContext,
  createDiscussionCommandContext,
  createDiscussionContext,
} from "../fixtures/index.js";

describe("Discussion Machine", () => {
  describe("detecting state transitions", () => {
    test("routes to researching for discussion_created trigger", () => {
      const context = createNewDiscussionContext();
      const actor = createActor(discussionMachine, { input: context });
      actor.start();

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("researching");
      expect(snapshot.status).toBe("done");
    });

    test("routes to responding for human discussion_comment", () => {
      const context = createDiscussionCommentContext({
        discussion: {
          commentAuthor: "human-user",
        },
      });
      const actor = createActor(discussionMachine, { input: context });
      actor.start();

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("responding");
      expect(snapshot.status).toBe("done");
    });

    test("routes to skipped for bot discussion_comment", () => {
      const context = createDiscussionCommentContext({
        discussion: {
          commentAuthor: "nopo-bot",
        },
      });
      const actor = createActor(discussionMachine, { input: context });
      actor.start();

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("skipped");
      expect(snapshot.status).toBe("done");
    });

    test("routes to summarizing for /summarize command", () => {
      const context = createDiscussionCommandContext("summarize");
      const actor = createActor(discussionMachine, { input: context });
      actor.start();

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("summarizing");
      expect(snapshot.status).toBe("done");
    });

    test("routes to planning for /plan command", () => {
      const context = createDiscussionCommandContext("plan");
      const actor = createActor(discussionMachine, { input: context });
      actor.start();

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("planning");
      expect(snapshot.status).toBe("done");
    });

    test("routes to completing for /complete command", () => {
      const context = createDiscussionCommandContext("complete");
      const actor = createActor(discussionMachine, { input: context });
      actor.start();

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("completing");
      expect(snapshot.status).toBe("done");
    });

    test("routes to noContext when discussion is null", () => {
      const context = createDiscussionContext();
      // Manually set discussion to null
      (context as { discussion: null }).discussion = null;
      const actor = createActor(discussionMachine, { input: context });
      actor.start();

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe("noContext");
      expect(snapshot.status).toBe("done");
    });
  });

  describe("researching state", () => {
    test("emits runClaudeResearch and applyDiscussionResearchOutput actions", () => {
      const context = createNewDiscussionContext({
        discussion: {
          number: 42,
          nodeId: "D_kwDOTest123",
          title: "Test Title",
          body: "Test Body",
        },
      });
      const actor = createActor(discussionMachine, { input: context });
      actor.start();

      const snapshot = actor.getSnapshot();
      const actions = snapshot.context.pendingActions;

      // Should have log + runClaude + applyDiscussionResearchOutput
      const runClaudeAction = actions.find((a) => a.type === "runClaude");
      const applyAction = actions.find(
        (a) => a.type === "applyDiscussionResearchOutput",
      );

      expect(runClaudeAction).toBeDefined();
      expect(runClaudeAction?.type).toBe("runClaude");
      if (runClaudeAction?.type === "runClaude") {
        expect(runClaudeAction.promptDir).toBe("discussion-research");
      }

      expect(applyAction).toBeDefined();
      expect(applyAction?.type).toBe("applyDiscussionResearchOutput");
    });
  });

  describe("responding state", () => {
    test("emits runClaudeRespond and applyDiscussionRespondOutput actions", () => {
      const context = createDiscussionCommentContext({
        discussion: {
          number: 42,
          nodeId: "D_kwDOTest123",
          commentId: "DC_kwDOTest456",
          commentBody: "A question",
          commentAuthor: "human-user",
        },
      });
      const actor = createActor(discussionMachine, { input: context });
      actor.start();

      const snapshot = actor.getSnapshot();
      const actions = snapshot.context.pendingActions;

      const runClaudeAction = actions.find((a) => a.type === "runClaude");
      const applyAction = actions.find(
        (a) => a.type === "applyDiscussionRespondOutput",
      );

      expect(runClaudeAction).toBeDefined();
      if (runClaudeAction?.type === "runClaude") {
        expect(runClaudeAction.promptDir).toBe("discussion-respond");
      }

      expect(applyAction).toBeDefined();
      if (applyAction?.type === "applyDiscussionRespondOutput") {
        expect(applyAction.replyToNodeId).toBe("DC_kwDOTest456");
      }
    });
  });

  describe("summarizing state", () => {
    test("emits runClaudeSummarize and applyDiscussionSummarizeOutput actions", () => {
      const context = createDiscussionCommandContext("summarize");
      const actor = createActor(discussionMachine, { input: context });
      actor.start();

      const snapshot = actor.getSnapshot();
      const actions = snapshot.context.pendingActions;

      const runClaudeAction = actions.find((a) => a.type === "runClaude");
      const applyAction = actions.find(
        (a) => a.type === "applyDiscussionSummarizeOutput",
      );

      expect(runClaudeAction).toBeDefined();
      if (runClaudeAction?.type === "runClaude") {
        expect(runClaudeAction.promptDir).toBe("discussion-summarize");
      }

      expect(applyAction).toBeDefined();
    });
  });

  describe("planning state", () => {
    test("emits runClaudePlan and applyDiscussionPlanOutput actions", () => {
      const context = createDiscussionCommandContext("plan");
      const actor = createActor(discussionMachine, { input: context });
      actor.start();

      const snapshot = actor.getSnapshot();
      const actions = snapshot.context.pendingActions;

      const runClaudeAction = actions.find((a) => a.type === "runClaude");
      const applyAction = actions.find(
        (a) => a.type === "applyDiscussionPlanOutput",
      );

      expect(runClaudeAction).toBeDefined();
      if (runClaudeAction?.type === "runClaude") {
        expect(runClaudeAction.promptDir).toBe("discussion-plan");
      }

      expect(applyAction).toBeDefined();
    });
  });

  describe("completing state", () => {
    test("emits addDiscussionReaction and addDiscussionComment actions", () => {
      const context = createDiscussionCommandContext("complete");
      const actor = createActor(discussionMachine, { input: context });
      actor.start();

      const snapshot = actor.getSnapshot();
      const actions = snapshot.context.pendingActions;

      const reactionAction = actions.find(
        (a) => a.type === "addDiscussionReaction",
      );
      const commentAction = actions.find(
        (a) => a.type === "addDiscussionComment",
      );

      expect(reactionAction).toBeDefined();
      if (reactionAction?.type === "addDiscussionReaction") {
        expect(reactionAction.content).toBe("ROCKET");
        // Default comment ID from the fixture
        expect(reactionAction.subjectId).toBe("DC_kwDOTest789");
      }

      expect(commentAction).toBeDefined();
      if (commentAction?.type === "addDiscussionComment") {
        expect(commentAction.body).toContain("marked as complete");
      }
    });
  });

  describe("all states are final", () => {
    test("researching is final", () => {
      const context = createNewDiscussionContext();
      const actor = createActor(discussionMachine, { input: context });
      actor.start();
      expect(actor.getSnapshot().status).toBe("done");
    });

    test("responding is final", () => {
      const context = createDiscussionCommentContext();
      const actor = createActor(discussionMachine, { input: context });
      actor.start();
      expect(actor.getSnapshot().status).toBe("done");
    });

    test("summarizing is final", () => {
      const context = createDiscussionCommandContext("summarize");
      const actor = createActor(discussionMachine, { input: context });
      actor.start();
      expect(actor.getSnapshot().status).toBe("done");
    });

    test("planning is final", () => {
      const context = createDiscussionCommandContext("plan");
      const actor = createActor(discussionMachine, { input: context });
      actor.start();
      expect(actor.getSnapshot().status).toBe("done");
    });

    test("completing is final", () => {
      const context = createDiscussionCommandContext("complete");
      const actor = createActor(discussionMachine, { input: context });
      actor.start();
      expect(actor.getSnapshot().status).toBe("done");
    });

    test("skipped is final", () => {
      const context = createDiscussionCommentContext({
        discussion: { commentAuthor: "nopo-bot" },
      });
      const actor = createActor(discussionMachine, { input: context });
      actor.start();
      expect(actor.getSnapshot().status).toBe("done");
    });

    test("noContext is final", () => {
      const context = createDiscussionContext();
      (context as { discussion: null }).discussion = null;
      const actor = createActor(discussionMachine, { input: context });
      actor.start();
      expect(actor.getSnapshot().status).toBe("done");
    });
  });
});
