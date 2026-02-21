import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeClaudeSDK, resolvePrompt } from "@more/claude";
import { createClaudeTriageService } from "../../src/machines/example/services.js";

vi.mock("@more/claude", () => ({
  resolvePrompt: vi.fn(),
  executeClaudeSDK: vi.fn(),
}));

describe("createClaudeTriageService", () => {
  beforeEach(() => {
    vi.mocked(resolvePrompt).mockReset();
    vi.mocked(executeClaudeSDK).mockReset();
  });

  it("maps Claude structured output into triage labels and summary", async () => {
    vi.mocked(resolvePrompt).mockReturnValue({
      prompt: "triage prompt",
      outputSchema: {},
    });
    vi.mocked(executeClaudeSDK).mockResolvedValue({
      success: true,
      exitCode: 0,
      output: "",
      structuredOutput: {
        triage: {
          type: "bug",
          topics: ["CI Pipeline", "Auth"],
          needs_info: true,
        },
        initial_approach: "Investigate failing checks and auth coupling.",
      },
    });

    const service = createClaudeTriageService();
    const result = await service.triageIssue({
      issueNumber: 42,
      promptVars: {
        ISSUE_NUMBER: "42",
        ISSUE_TITLE: "Broken checks",
        ISSUE_BODY: "Body",
        ISSUE_COMMENTS: "",
      },
    });

    expect(resolvePrompt).toHaveBeenCalledWith({
      promptDir: "triage",
      promptVars: {
        ISSUE_NUMBER: "42",
        ISSUE_TITLE: "Broken checks",
        ISSUE_BODY: "Body",
        ISSUE_COMMENTS: "",
      },
    });
    expect(executeClaudeSDK).toHaveBeenCalledOnce();
    expect(result).toEqual({
      labelsToAdd: [
        "type:bug",
        "needs-info",
        "topic:ci-pipeline",
        "topic:auth",
      ],
      summary: "Investigate failing checks and auth coupling.",
    });
  });

  it("throws when Claude execution fails", async () => {
    vi.mocked(resolvePrompt).mockReturnValue({
      prompt: "triage prompt",
      outputSchema: {},
    });
    vi.mocked(executeClaudeSDK).mockResolvedValue({
      success: false,
      exitCode: 1,
      output: "",
      error: "claude unavailable",
    });

    const service = createClaudeTriageService();
    await expect(
      service.triageIssue({
        issueNumber: 42,
        promptVars: {
          ISSUE_NUMBER: "42",
          ISSUE_TITLE: "Broken checks",
          ISSUE_BODY: "Body",
          ISSUE_COMMENTS: "",
        },
      }),
    ).rejects.toThrow("claude unavailable");
  });

  it("throws when Claude structured output is invalid", async () => {
    vi.mocked(resolvePrompt).mockReturnValue({
      prompt: "triage prompt",
      outputSchema: {},
    });
    vi.mocked(executeClaudeSDK).mockResolvedValue({
      success: true,
      exitCode: 0,
      output: "",
      structuredOutput: {
        triage: {
          type: "not-a-valid-type",
          topics: ["ci"],
          needs_info: false,
        },
        initial_approach: "bad payload",
      },
    });

    const service = createClaudeTriageService();
    await expect(
      service.triageIssue({
        issueNumber: 42,
        promptVars: {
          ISSUE_NUMBER: "42",
          ISSUE_TITLE: "Broken checks",
          ISSUE_BODY: "Body",
          ISSUE_COMMENTS: "",
        },
      }),
    ).rejects.toThrow();
  });
});
