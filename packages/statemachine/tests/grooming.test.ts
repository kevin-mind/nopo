import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "@more/issue-state";
import type { Root } from "mdast";
import {
  GroomingSummaryOutputSchema,
  type GroomingSummaryOutput,
  type CombinedGroomingOutput,
} from "../src/runner/executors/output-schemas.js";
import {
  buildFallbackSummary,
  buildQuestionsContent,
} from "../src/runner/executors/grooming.js";
import {
  extractQuestionsFromAst,
  extractQuestionItems,
} from "../src/parser/index.js";

// ============================================================================
// GroomingSummaryOutputSchema
// ============================================================================

describe("GroomingSummaryOutputSchema", () => {
  it("parses a valid needs_info output with consolidated questions", () => {
    const data = {
      summary: "Issue needs clarification on auth strategy.",
      decision: "needs_info",
      decision_rationale: "Engineer and PM have unresolved questions.",
      consolidated_questions: [
        {
          id: "auth-strategy",
          title: "Which auth method to use?",
          description:
            "Both PM and Engineer need clarity on whether to use OAuth or JWT.",
          sources: ["pm", "engineer"],
          priority: "critical",
        },
      ],
    };

    const result = GroomingSummaryOutputSchema.parse(data);
    expect(result.decision).toBe("needs_info");
    expect(result.consolidated_questions).toHaveLength(1);

    const q = result.consolidated_questions?.[0];
    expect(q?.id).toBe("auth-strategy");
    expect(q?.sources).toEqual(["pm", "engineer"]);
  });

  it("parses a valid ready output without questions", () => {
    const data = {
      summary: "All agents agree the issue is ready.",
      consensus: ["Clear requirements", "Good test plan"],
      decision: "ready",
      decision_rationale: "All agents ready, phases provided.",
      next_steps: ["Create sub-issues"],
    };

    const result = GroomingSummaryOutputSchema.parse(data);
    expect(result.decision).toBe("ready");
    expect(result.consolidated_questions).toBeUndefined();
    expect(result.answered_questions).toBeUndefined();
  });

  it("parses output with answered questions", () => {
    const data = {
      summary: "Some questions resolved since last run.",
      decision: "needs_info",
      decision_rationale: "One critical question remains.",
      consolidated_questions: [
        {
          id: "db-migration",
          title: "Migration strategy?",
          description: "Need to decide expand-contract vs big bang.",
          sources: ["engineer"],
          priority: "important",
        },
      ],
      answered_questions: [
        {
          id: "auth-strategy",
          title: "Which auth method to use?",
          answer_summary: "Team decided on OAuth based on issue comments.",
        },
      ],
    };

    const result = GroomingSummaryOutputSchema.parse(data);
    expect(result.consolidated_questions).toHaveLength(1);
    expect(result.answered_questions).toHaveLength(1);
    expect(result.answered_questions?.[0]?.id).toBe("auth-strategy");
  });

  it("parses blocked output with blocker reason", () => {
    const data = {
      summary: "Blocked by external dependency.",
      decision: "blocked",
      decision_rationale: "Cannot proceed without API access.",
      blocker_reason: "Waiting on third-party API credentials.",
    };

    const result = GroomingSummaryOutputSchema.parse(data);
    expect(result.decision).toBe("blocked");
    expect(result.blocker_reason).toBe(
      "Waiting on third-party API credentials.",
    );
  });

  it("rejects invalid decision value", () => {
    const data = {
      summary: "Test",
      decision: "maybe",
      decision_rationale: "Not sure.",
    };

    expect(() => GroomingSummaryOutputSchema.parse(data)).toThrow();
  });

  it("rejects invalid source in consolidated questions", () => {
    const data = {
      summary: "Test",
      decision: "needs_info",
      decision_rationale: "Questions remain.",
      consolidated_questions: [
        {
          id: "test",
          title: "Test question",
          description: "Test",
          sources: ["designer"],
          priority: "important",
        },
      ],
    };

    expect(() => GroomingSummaryOutputSchema.parse(data)).toThrow();
  });

  it("rejects invalid priority in consolidated questions", () => {
    const data = {
      summary: "Test",
      decision: "needs_info",
      decision_rationale: "Questions remain.",
      consolidated_questions: [
        {
          id: "test",
          title: "Test question",
          description: "Test",
          sources: ["pm"],
          priority: "urgent",
        },
      ],
    };

    expect(() => GroomingSummaryOutputSchema.parse(data)).toThrow();
  });
});

// ============================================================================
// buildFallbackSummary
// ============================================================================

describe("buildFallbackSummary", () => {
  it("collects questions from all agents", () => {
    const groomingOutput: CombinedGroomingOutput = {
      pm: { ready: false, questions: ["What is the scope?"] },
      engineer: { ready: false, questions: ["Which framework?"] },
      qa: { ready: true },
      research: { ready: false, questions: ["Any prior art?"] },
    };

    const result = buildFallbackSummary(groomingOutput);
    const questions = result.consolidated_questions;

    expect(result.decision).toBe("needs_info");
    expect(questions).toBeDefined();
    expect(questions).toHaveLength(3);
    expect(questions?.[0]?.sources).toEqual(["pm"]);
    expect(questions?.[0]?.description).toBe("What is the scope?");
    expect(questions?.[1]?.sources).toEqual(["engineer"]);
    expect(questions?.[2]?.sources).toEqual(["research"]);
  });

  it("assigns sequential fallback IDs", () => {
    const groomingOutput: CombinedGroomingOutput = {
      pm: { ready: false, questions: ["Q1", "Q2"] },
      engineer: { ready: true },
      qa: { ready: false, questions: ["Q3"] },
      research: { ready: true },
    };

    const result = buildFallbackSummary(groomingOutput);
    const questions = result.consolidated_questions;

    expect(questions?.[0]?.id).toBe("fallback-0");
    expect(questions?.[1]?.id).toBe("fallback-1");
    expect(questions?.[2]?.id).toBe("fallback-2");
  });

  it("truncates long questions in the title", () => {
    const longQuestion =
      "This is a very long question that exceeds sixty characters in length and should be truncated";
    const groomingOutput: CombinedGroomingOutput = {
      pm: { ready: false, questions: [longQuestion] },
      engineer: { ready: true },
      qa: { ready: true },
      research: { ready: true },
    };

    const result = buildFallbackSummary(groomingOutput);
    const questions = result.consolidated_questions;
    const first = questions?.[0];

    expect(first).toBeDefined();
    expect(first?.title.length).toBeLessThanOrEqual(60);
    expect(first?.title.endsWith("...")).toBe(true);
    expect(first?.description).toBe(longQuestion);
  });

  it("returns empty questions when all agents are ready", () => {
    const groomingOutput: CombinedGroomingOutput = {
      pm: { ready: true },
      engineer: { ready: true },
      qa: { ready: true },
      research: { ready: true },
    };

    const result = buildFallbackSummary(groomingOutput);

    expect(result.consolidated_questions).toHaveLength(0);
  });

  it("sets all priorities to important", () => {
    const groomingOutput: CombinedGroomingOutput = {
      pm: { ready: false, questions: ["Q1"] },
      engineer: { ready: true },
      qa: { ready: true },
      research: { ready: true },
    };

    const result = buildFallbackSummary(groomingOutput);
    const questions = result.consolidated_questions;

    expect(questions?.[0]?.priority).toBe("important");
  });

  it("output validates against GroomingSummaryOutputSchema", () => {
    const groomingOutput: CombinedGroomingOutput = {
      pm: { ready: false, questions: ["Q1"] },
      engineer: { ready: false, questions: ["Q2", "Q3"] },
      qa: { ready: true },
      research: { ready: false, questions: ["Q4"] },
    };

    const result = buildFallbackSummary(groomingOutput);

    expect(() => GroomingSummaryOutputSchema.parse(result)).not.toThrow();
  });
});

// ============================================================================
// buildQuestionsContent
// ============================================================================

describe("buildQuestionsContent", () => {
  /** Helper to serialize MDAST nodes to markdown for assertion */
  function contentToMarkdown(
    content: ReturnType<typeof buildQuestionsContent>,
  ): string {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test helper
    const ast: Root = { type: "root", children: content as Root["children"] };
    return serializeMarkdown(ast);
  }

  it("returns empty array when no questions", () => {
    const summary: GroomingSummaryOutput = {
      summary: "All good.",
      decision: "needs_info",
      decision_rationale: "No questions.",
    };

    const result = buildQuestionsContent(summary, []);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when both arrays are empty and no existing", () => {
    const summary: GroomingSummaryOutput = {
      summary: "All good.",
      decision: "needs_info",
      decision_rationale: "No questions.",
      consolidated_questions: [],
      answered_questions: [],
    };

    const result = buildQuestionsContent(summary, []);
    expect(result).toHaveLength(0);
  });

  it("creates unchecked items for pending questions with format", () => {
    const summary: GroomingSummaryOutput = {
      summary: "Questions remain.",
      decision: "needs_info",
      decision_rationale: "Pending questions.",
      consolidated_questions: [
        {
          id: "auth-method",
          title: "Auth method?",
          description: "Need to decide OAuth vs JWT.",
          sources: ["pm", "engineer"],
          priority: "important",
        },
      ],
    };

    const result = buildQuestionsContent(summary, []);
    expect(result).toHaveLength(1);

    const md = contentToMarkdown(result);
    expect(md).toContain("Auth method?");
    expect(md).toContain("Need to decide OAuth vs JWT.");
    expect(md).toContain("(pm, engineer)");
    expect(md).toContain("`id:auth-method`");
  });

  it("creates checked items for answered questions", () => {
    const summary: GroomingSummaryOutput = {
      summary: "Resolved.",
      decision: "needs_info",
      decision_rationale: "Progress.",
      answered_questions: [
        {
          id: "resolved",
          title: "Resolved question",
          answer_summary: "Decided to use OAuth.",
        },
      ],
    };

    const result = buildQuestionsContent(summary, []);
    expect(result).toHaveLength(1);

    const md = contentToMarkdown(result);
    expect(md).toContain("[x]");
    expect(md).toContain("~~Resolved question~~");
    expect(md).toContain("Decided to use OAuth.");
    expect(md).toContain("`id:resolved`");
  });

  it("drops triage questions (no ID) when summary has output", () => {
    const summary: GroomingSummaryOutput = {
      summary: "Questions remain.",
      decision: "needs_info",
      decision_rationale: "Pending questions.",
      consolidated_questions: [
        {
          id: "new-q",
          title: "New question",
          description: "Something new.",
          sources: ["pm"],
          priority: "important",
        },
      ],
    };

    const existingQuestions = [
      { id: null, text: "What about performance?", checked: false },
    ];

    const result = buildQuestionsContent(summary, existingQuestions);
    const md = contentToMarkdown(result);

    // Triage question dropped (superseded by summary)
    expect(md).not.toContain("What about performance?");
    // New grooming question present
    expect(md).toContain("New question");
  });

  it("preserves triage questions (no ID) when summary has no output", () => {
    const summary: GroomingSummaryOutput = {
      summary: "No questions.",
      decision: "ready",
      decision_rationale: "All clear.",
      consolidated_questions: [],
    };

    const existingQuestions = [
      { id: null, text: "What about performance?", checked: false },
    ];

    const result = buildQuestionsContent(summary, existingQuestions);
    const md = contentToMarkdown(result);

    // Triage question preserved when summary has no output
    expect(md).toContain("What about performance?");
  });

  it("respects user-checked state on re-run", () => {
    const summary: GroomingSummaryOutput = {
      summary: "Re-run.",
      decision: "needs_info",
      decision_rationale: "Re-evaluating.",
      consolidated_questions: [
        {
          id: "auth-method",
          title: "Auth method?",
          description: "Need to decide.",
          sources: ["pm"],
          priority: "important",
        },
      ],
    };

    // User already checked this question
    const existingQuestions = [
      {
        id: "auth-method",
        text: "**Auth method?** - Original `id:auth-method`",
        checked: true,
      },
    ];

    const result = buildQuestionsContent(summary, existingQuestions);
    const md = contentToMarkdown(result);

    // Should be checked because user checked it
    expect(md).toContain("[x]");
    expect(md).toContain("`id:auth-method`");
  });

  it("embeds IDs as inline code in text", () => {
    const summary: GroomingSummaryOutput = {
      summary: "Questions.",
      decision: "needs_info",
      decision_rationale: "Questions.",
      consolidated_questions: [
        {
          id: "db-schema",
          title: "DB schema?",
          description: "Which tables?",
          sources: ["engineer"],
          priority: "important",
        },
      ],
    };

    const result = buildQuestionsContent(summary, []);
    const md = contentToMarkdown(result);

    expect(md).toContain("`id:db-schema`");
  });

  it("renders critical priority tag", () => {
    const summary: GroomingSummaryOutput = {
      summary: "Critical.",
      decision: "needs_info",
      decision_rationale: "Blocking.",
      consolidated_questions: [
        {
          id: "blocking",
          title: "Blocking question",
          description: "This blocks everything.",
          sources: ["pm"],
          priority: "critical",
        },
      ],
    };

    const result = buildQuestionsContent(summary, []);
    const md = contentToMarkdown(result);

    expect(md).toContain("**\\[critical]**");
  });

  it("preserves existing grooming questions not in new output", () => {
    const summary: GroomingSummaryOutput = {
      summary: "Partial re-run.",
      decision: "needs_info",
      decision_rationale: "Some questions remain.",
      consolidated_questions: [
        {
          id: "new-q",
          title: "New question",
          description: "Something new.",
          sources: ["pm"],
          priority: "important",
        },
      ],
    };

    const existingQuestions = [
      {
        id: "old-q",
        text: "**Old question** - Still relevant `id:old-q`",
        checked: false,
      },
    ];

    const result = buildQuestionsContent(summary, existingQuestions);
    const md = contentToMarkdown(result);

    // Old question preserved
    expect(md).toContain("Old question");
    expect(md).toContain("`id:old-q`");
    // New question also present
    expect(md).toContain("New question");
    expect(md).toContain("`id:new-q`");
  });
});

// ============================================================================
// extractQuestionItems
// ============================================================================

describe("extractQuestionItems", () => {
  it("returns empty array for body without Questions section", () => {
    const ast = parseMarkdown("## Description\n\nSome content.");
    expect(extractQuestionItems(ast)).toEqual([]);
  });

  it("extracts items without IDs", () => {
    const ast = parseMarkdown(
      "## Questions\n\n- [ ] What about performance?\n- [x] How to test?",
    );
    const items = extractQuestionItems(ast);

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id: null,
      text: "What about performance?",
      checked: false,
    });
    expect(items[1]).toEqual({
      id: null,
      text: "How to test?",
      checked: true,
    });
  });

  it("extracts items with IDs from inline code", () => {
    const ast = parseMarkdown(
      "## Questions\n\n- [ ] **Auth method?** - Need to decide `id:auth-method`\n- [x] ~~Resolved~~ - Done `id:resolved-q`",
    );
    const items = extractQuestionItems(ast);

    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe("auth-method");
    expect(items[0]?.checked).toBe(false);
    expect(items[1]?.id).toBe("resolved-q");
    expect(items[1]?.checked).toBe(true);
  });

  it("respects checked state", () => {
    const ast = parseMarkdown(
      "## Questions\n\n- [x] Done question `id:done`\n- [ ] Open question `id:open`",
    );
    const items = extractQuestionItems(ast);

    expect(items[0]?.checked).toBe(true);
    expect(items[1]?.checked).toBe(false);
  });
});

// ============================================================================
// extractQuestionsFromAst
// ============================================================================

describe("extractQuestionsFromAst", () => {
  it("returns zeros when no Questions section", () => {
    const ast = parseMarkdown("## Description\n\nSome content.");
    const stats = extractQuestionsFromAst(ast);

    expect(stats).toEqual({ total: 0, answered: 0, unanswered: 0 });
  });

  it("counts questions correctly", () => {
    const ast = parseMarkdown(
      "## Questions\n\n- [ ] Open 1\n- [x] Answered 1\n- [ ] Open 2\n- [x] Answered 2",
    );
    const stats = extractQuestionsFromAst(ast);

    expect(stats).toEqual({ total: 4, answered: 2, unanswered: 2 });
  });

  it("returns all answered when all checked", () => {
    const ast = parseMarkdown("## Questions\n\n- [x] Done 1\n- [x] Done 2");
    const stats = extractQuestionsFromAst(ast);

    expect(stats).toEqual({ total: 2, answered: 2, unanswered: 0 });
  });

  it("handles empty Questions section", () => {
    const ast = parseMarkdown("## Questions\n\nNo checklist here.\n\n## Next");
    const stats = extractQuestionsFromAst(ast);

    expect(stats).toEqual({ total: 0, answered: 0, unanswered: 0 });
  });
});
