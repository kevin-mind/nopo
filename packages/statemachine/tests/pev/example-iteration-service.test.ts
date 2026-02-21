import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeClaudeSDK, resolvePrompt } from "@more/claude";
import { createClaudeIterationService } from "../../src/machines/example/services.js";

vi.mock("@more/claude", () => ({
  resolvePrompt: vi.fn(),
  executeClaudeSDK: vi.fn(),
}));

describe("createClaudeIterationService", () => {
  beforeEach(() => {
    vi.mocked(resolvePrompt).mockReset();
    vi.mocked(executeClaudeSDK).mockReset();
  });

  it("maps Claude structured output into iteration labels and summary", async () => {
    vi.mocked(resolvePrompt).mockReturnValue({
      prompt: "iterate prompt",
      outputSchema: {},
    });
    vi.mocked(executeClaudeSDK).mockResolvedValue({
      success: true,
      exitCode: 0,
      output: "",
      structuredOutput: {
        status: "completed_todo",
        todos_completed: ["Fix flaky test"],
        agent_notes: ["Fix tests", "then request review"],
      },
    });

    const service = createClaudeIterationService();
    const result = await service.iterateIssue({
      issueNumber: 42,
      mode: "iterate",
      promptVars: {
        ISSUE_NUMBER: "42",
        ISSUE_TITLE: "Flaky CI",
        ISSUE_BODY: "Body",
        ISSUE_COMMENTS: "",
        ISSUE_LABELS: "triaged,groomed",
        CI_RESULT: "failure",
        REVIEW_DECISION: "none",
      },
    });

    expect(resolvePrompt).toHaveBeenCalledWith({
      promptDir: "iterate",
      promptVars: {
        ISSUE_NUMBER: "42",
        ISSUE_TITLE: "Flaky CI",
        ISSUE_BODY: "Body",
        ISSUE_COMMENTS: "",
        ISSUE_LABELS: "triaged,groomed",
        CI_RESULT: "failure",
        REVIEW_DECISION: "none",
      },
    });
    expect(result).toEqual({
      labelsToAdd: [],
      summary: "Fix tests; then request review",
      status: "completed_todo",
      todosCompleted: ["Fix flaky test"],
    });
  });
});
