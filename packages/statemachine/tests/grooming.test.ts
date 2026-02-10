import { describe, it, expect } from "vitest";
import {
  GroomingSummaryOutputSchema,
  type GroomingSummaryOutput,
  type CombinedGroomingOutput,
} from "../src/runner/executors/output-schemas.js";
import {
  buildFallbackSummary,
  buildGroomingQuestionsComment,
  GROOMING_QUESTIONS_HEADING,
} from "../src/runner/executors/grooming.js";

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
// buildGroomingQuestionsComment
// ============================================================================

describe("buildGroomingQuestionsComment", () => {
  it("returns null when no questions", () => {
    const summary: GroomingSummaryOutput = {
      summary: "All good.",
      decision: "needs_info",
      decision_rationale: "No questions.",
    };

    expect(buildGroomingQuestionsComment(summary)).toBeNull();
  });

  it("returns null when both arrays are empty", () => {
    const summary: GroomingSummaryOutput = {
      summary: "All good.",
      decision: "needs_info",
      decision_rationale: "No questions.",
      consolidated_questions: [],
      answered_questions: [],
    };

    expect(buildGroomingQuestionsComment(summary)).toBeNull();
  });

  it("starts with the grooming questions heading", () => {
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
          priority: "critical",
        },
      ],
    };

    const result = buildGroomingQuestionsComment(summary);
    expect(result?.startsWith(GROOMING_QUESTIONS_HEADING)).toBe(true);
  });

  it("renders pending questions as unchecked items", () => {
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
        {
          id: "db-schema",
          title: "DB schema design?",
          description: "Which tables are needed?",
          sources: ["engineer"],
          priority: "nice-to-have",
        },
      ],
    };

    const result = buildGroomingQuestionsComment(summary);
    expect(result).toContain("- [ ] **Auth method?** - Need to decide");
    expect(result).toContain("_(pm, engineer)_");
    expect(result).toContain("- [ ] **DB schema design?**");
    expect(result).toContain("_(engineer)_");
  });

  it("marks critical questions with priority tag", () => {
    const summary: GroomingSummaryOutput = {
      summary: "Critical question.",
      decision: "needs_info",
      decision_rationale: "Blocking question.",
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

    const result = buildGroomingQuestionsComment(summary);
    expect(result).toContain("**[critical]**");
  });

  it("does not add priority tag for non-critical questions", () => {
    const summary: GroomingSummaryOutput = {
      summary: "Minor question.",
      decision: "needs_info",
      decision_rationale: "Non-blocking.",
      consolidated_questions: [
        {
          id: "minor",
          title: "Minor detail",
          description: "Just curious.",
          sources: ["qa"],
          priority: "nice-to-have",
        },
      ],
    };

    const result = buildGroomingQuestionsComment(summary);
    expect(result).not.toContain("**[critical]**");
  });

  it("renders answered questions as checked items with strikethrough", () => {
    const summary: GroomingSummaryOutput = {
      summary: "Some resolved.",
      decision: "needs_info",
      decision_rationale: "Progress made.",
      consolidated_questions: [
        {
          id: "remaining",
          title: "Open question",
          description: "Still unanswered.",
          sources: ["pm"],
          priority: "important",
        },
      ],
      answered_questions: [
        {
          id: "resolved",
          title: "Resolved question",
          answer_summary: "Decided to use OAuth.",
        },
      ],
    };

    const result = buildGroomingQuestionsComment(summary);
    expect(result).toContain("### Resolved");
    expect(result).toContain(
      "- [x] ~~Resolved question~~ - Decided to use OAuth.",
    );
  });

  it("renders comment with only answered questions", () => {
    const summary: GroomingSummaryOutput = {
      summary: "All resolved.",
      decision: "needs_info",
      decision_rationale: "Was needs_info, now all answered.",
      answered_questions: [
        {
          id: "q1",
          title: "First question",
          answer_summary: "Answered in comments.",
        },
      ],
    };

    const result = buildGroomingQuestionsComment(summary);
    expect(result).not.toBeNull();
    expect(result).toContain("### Resolved");
    expect(result).toContain("- [x] ~~First question~~");
  });
});
