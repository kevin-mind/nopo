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

  it("maps Claude structured output into grooming labels and phases", async () => {
    vi.mocked(resolvePrompt).mockReturnValue({
      prompt: "grooming prompt",
      outputSchema: {},
    });
    // 4 agent calls + 1 summary call = 5 total
    vi.mocked(executeClaudeSDK)
      // Engineer
      .mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        output: "",
        structuredOutput: {
          implementation_plan: "Split by API and UI tracks",
          recommended_phases: [
            {
              phase_number: 1,
              title: "Backend API",
              description: "Build API endpoints",
            },
            {
              phase_number: 2,
              title: "Frontend UI",
              description: "Build UI components",
            },
          ],
        },
      })
      // PM
      .mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        output: "",
        structuredOutput: { pm_analysis: "Looks good" },
      })
      // QA
      .mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        output: "",
        structuredOutput: { qa_analysis: "Add integration tests" },
      })
      // Research
      .mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        output: "",
        structuredOutput: { research: "No blockers found" },
      })
      // Summary
      .mockResolvedValueOnce({
        success: true,
        exitCode: 0,
        output: "",
        structuredOutput: {
          summary: "Split by API and UI tracks",
          decision: "ready",
          decision_rationale: "All agents agree on approach",
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

    // 4 agent prompt resolutions + 1 summary
    expect(resolvePrompt).toHaveBeenCalledTimes(5);
    expect(resolvePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ promptDir: "grooming/engineer" }),
    );
    expect(resolvePrompt).toHaveBeenCalledWith(
      expect.objectContaining({ promptDir: "grooming/summary" }),
    );
    expect(result).toEqual({
      labelsToAdd: ["groomed"],
      summary: "Split by API and UI tracks",
      decision: "ready",
      recommendedPhases: [
        {
          phase_number: 1,
          title: "Backend API",
          description: "Build API endpoints",
        },
        {
          phase_number: 2,
          title: "Frontend UI",
          description: "Build UI components",
        },
      ],
      consolidatedQuestions: undefined,
      answeredQuestions: undefined,
      blockerReason: undefined,
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
