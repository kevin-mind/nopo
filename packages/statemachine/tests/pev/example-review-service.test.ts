import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeClaudeSDK, resolvePrompt } from "@more/claude";
import {
  createClaudePrResponseService,
  createClaudeReviewService,
} from "../../src/machines/example/services.js";

vi.mock("@more/claude", () => ({
  resolvePrompt: vi.fn(),
  executeClaudeSDK: vi.fn(),
}));

describe("review services", () => {
  beforeEach(() => {
    vi.mocked(resolvePrompt).mockReset();
    vi.mocked(executeClaudeSDK).mockReset();
  });

  it("maps review structured output", async () => {
    vi.mocked(resolvePrompt).mockReturnValue({
      prompt: "review prompt",
      outputSchema: {},
    });
    vi.mocked(executeClaudeSDK).mockResolvedValue({
      success: true,
      exitCode: 0,
      output: "",
      structuredOutput: {
        decision: "request_changes",
        body: "Investigate requested follow-up changes",
        agent_notes: ["checked CI logs"],
      },
    });

    const service = createClaudeReviewService();
    const result = await service.reviewIssue({
      issueNumber: 42,
      promptVars: {
        ISSUE_NUMBER: "42",
        ISSUE_TITLE: "Title",
        ISSUE_BODY: "Body",
        ISSUE_COMMENTS: "",
        REVIEW_DECISION: "CHANGES_REQUESTED",
        REVIEWER: "alice",
      },
    });

    expect(result).toEqual({
      decision: "request_changes",
      body: "Investigate requested follow-up changes",
      agentNotes: ["checked CI logs"],
    });
  });

  it("maps pr response structured output", async () => {
    vi.mocked(resolvePrompt).mockReturnValue({
      prompt: "pr response prompt",
      outputSchema: {},
    });
    vi.mocked(executeClaudeSDK).mockResolvedValue({
      success: true,
      exitCode: 0,
      output: "",
      structuredOutput: {
        pr_response: {
          labels_to_add: ["awaiting-human"],
        },
        summary: "Prepared reply and highlighted blockers",
      },
    });

    const service = createClaudePrResponseService();
    const result = await service.respondToPr({
      issueNumber: 42,
      promptVars: {
        ISSUE_NUMBER: "42",
        ISSUE_TITLE: "Title",
        ISSUE_BODY: "Body",
        ISSUE_COMMENTS: "",
        REVIEW_DECISION: "COMMENTED",
        REVIEWER: "bob",
      },
    });

    expect(result).toEqual({
      labelsToAdd: ["awaiting-human"],
      summary: "Prepared reply and highlighted blockers",
    });
  });
});
