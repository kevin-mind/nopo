import { describe, it, expect } from "vitest";
import { serializeBody } from "../../src/markdown/body-serializer.js";

describe("serializeBody", () => {
  it("serializes description and sections", () => {
    const result = serializeBody({
      description: "Main description.",
      sections: [
        { name: "Approach", content: "Use TDD." },
        { name: "Todo", content: "- [ ] Write tests" },
      ],
    });

    expect(result).toContain("Main description.");
    expect(result).toContain("## Approach\n\nUse TDD.");
    expect(result).toContain("## Todo\n\n- [ ] Write tests");
  });

  it("serializes history entries", () => {
    const result = serializeBody({
      description: "Desc",
      history: [
        { iteration: 1, phase: "1", action: "Started", timestamp: "Jan 22", sha: null, runLink: null },
      ],
    });

    expect(result).toContain("## Iteration History");
    expect(result).toContain("Started");
  });

  it("serializes agent notes", () => {
    const result = serializeBody({
      description: "Desc",
      agentNotes: [
        {
          runId: "12345",
          runLink: "https://github.com/o/r/actions/runs/12345",
          timestamp: "Jan 22 19:04",
          notes: ["Found a bug"],
        },
      ],
    });

    expect(result).toContain("## Agent Notes");
    expect(result).toContain("Run 12345");
    expect(result).toContain("Found a bug");
  });

  it("skips Iteration History and Agent Notes sections", () => {
    const result = serializeBody({
      sections: [
        { name: "Approach", content: "Use TDD." },
        { name: "Iteration History", content: "Should be skipped" },
        { name: "Agent Notes", content: "Should be skipped" },
      ],
    });

    // Should have Approach but not the raw Iteration History / Agent Notes sections
    expect(result).toContain("## Approach");
    expect(result).not.toContain("Should be skipped");
  });

  it("handles empty options", () => {
    const result = serializeBody({});
    expect(result).toBe("");
  });
});
