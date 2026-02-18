import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeClaudeSDK, resolvePrompt } from "@more/claude";
import { createClaudeGroomingService } from "../../src/machines/example/services.js";

vi.mock("@more/claude", () => ({
  resolvePrompt: vi.fn(),
  executeClaudeSDK: vi.fn(),
}));

describe("createClaudeGroomingService", () => {
  beforeEach(() => {
    vi.mocked(resolvePrompt).mockReset();
    vi.mocked(executeClaudeSDK).mockReset();
  });

  it("maps Claude structured output into grooming labels and sub-issues", async () => {
    vi.mocked(resolvePrompt).mockReturnValue({
      prompt: "grooming prompt",
      outputSchema: {},
    });
    vi.mocked(executeClaudeSDK).mockResolvedValue({
      success: true,
      exitCode: 0,
      output: "",
      structuredOutput: {
        grooming: {
          labels_to_add: ["Needs Spec", "groomed"],
          suggested_sub_issues: [{ number: 421 }, { number: 422 }],
        },
        implementation_plan: "Split by API and UI tracks",
      },
    });

    const service = createClaudeGroomingService();
    const result = await service.groomIssue({
      issueNumber: 42,
      promptVars: {
        ISSUE_NUMBER: "42",
        ISSUE_TITLE: "Improve onboarding",
        ISSUE_BODY: "Body",
        ISSUE_COMMENTS: "",
        ISSUE_LABELS: "triaged,type:enhancement",
      },
    });

    expect(resolvePrompt).toHaveBeenCalledWith({
      promptDir: "grooming",
      promptVars: {
        ISSUE_NUMBER: "42",
        ISSUE_TITLE: "Improve onboarding",
        ISSUE_BODY: "Body",
        ISSUE_COMMENTS: "",
        ISSUE_LABELS: "triaged,type:enhancement",
      },
    });
    expect(result).toEqual({
      labelsToAdd: ["groomed", "needs-spec"],
      suggestedSubIssueNumbers: [421, 422],
      summary: "Split by API and UI tracks",
    });
  });

  it("throws when Claude grooming execution fails", async () => {
    vi.mocked(resolvePrompt).mockReturnValue({
      prompt: "grooming prompt",
      outputSchema: {},
    });
    vi.mocked(executeClaudeSDK).mockResolvedValue({
      success: false,
      exitCode: 1,
      output: "",
      error: "claude unavailable",
    });

    const service = createClaudeGroomingService();
    await expect(
      service.groomIssue({
        issueNumber: 42,
        promptVars: {
          ISSUE_NUMBER: "42",
          ISSUE_TITLE: "Improve onboarding",
          ISSUE_BODY: "Body",
          ISSUE_COMMENTS: "",
          ISSUE_LABELS: "triaged",
        },
      }),
    ).rejects.toThrow("claude unavailable");
  });
});
