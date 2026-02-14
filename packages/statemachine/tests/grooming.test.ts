import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "@more/issue-state";
import type { Root } from "mdast";
import {
  GroomingSummaryOutputSchema,
  SubIssueSpecSchema,
  ExistingSubIssueSchema,
  ReconcileSubIssuesOutputSchema,
  type GroomingSummaryOutput,
  type CombinedGroomingOutput,
} from "../src/runner/helpers/output-schemas.js";
import {
  buildFallbackSummary,
  buildQuestionsContent,
  buildPhaseIssueBody,
  mergeTodos,
  normalizeTodoText,
  extractExistingTodos,
} from "../src/schemas/actions/index.js";
import {
  extractQuestionsFromAst,
  extractQuestionItems,
  extractSubIssueSpecs,
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

// ============================================================================
// SubIssueSpecSchema / ExistingSubIssueSchema / ReconcileSubIssuesOutputSchema
// ============================================================================

describe("SubIssueSpecSchema", () => {
  it("parses a valid spec with all fields", () => {
    const data = {
      phase_number: 1,
      title: "Setup auth",
      description: "Implement authentication",
      affected_areas: [
        { path: "src/auth.ts", change_type: "add", description: "New file" },
      ],
      todos: [{ task: "Create auth module", manual: false }],
      depends_on: [],
    };

    const result = SubIssueSpecSchema.parse(data);
    expect(result.phase_number).toBe(1);
    expect(result.title).toBe("Setup auth");
    expect(result.affected_areas).toHaveLength(1);
    expect(result.todos).toHaveLength(1);
  });

  it("parses a minimal spec", () => {
    const data = {
      phase_number: 2,
      title: "Testing",
      description: "Add tests",
    };

    const result = SubIssueSpecSchema.parse(data);
    expect(result.phase_number).toBe(2);
    expect(result.affected_areas).toBeUndefined();
    expect(result.todos).toBeUndefined();
  });
});

describe("ExistingSubIssueSchema", () => {
  it("extends SubIssueSpec with number field", () => {
    const data = {
      number: 42,
      phase_number: 1,
      title: "Setup auth",
      description: "Implement authentication",
    };

    const result = ExistingSubIssueSchema.parse(data);
    expect(result.number).toBe(42);
    expect(result.phase_number).toBe(1);
  });

  it("rejects without number", () => {
    const data = {
      phase_number: 1,
      title: "Test",
      description: "Test",
    };

    expect(() => ExistingSubIssueSchema.parse(data)).toThrow();
  });
});

describe("ReconcileSubIssuesOutputSchema", () => {
  it("parses a valid reconciliation output", () => {
    const data = {
      create: [
        { phase_number: 3, title: "New phase", description: "Brand new" },
      ],
      update: [
        {
          number: 10,
          phase_number: 1,
          title: "Updated phase",
          description: "Updated desc",
          match_reason: "Same scope as existing #10",
        },
      ],
      delete: [{ number: 11, reason: "No longer needed" }],
      reasoning: "Phase 3 is new, Phase 1 matches #10, #11 is superseded",
    };

    const result = ReconcileSubIssuesOutputSchema.parse(data);
    expect(result.create).toHaveLength(1);
    expect(result.update).toHaveLength(1);
    expect(result.update[0]?.match_reason).toBe("Same scope as existing #10");
    expect(result.delete).toHaveLength(1);
    expect(result.reasoning).toBeTruthy();
  });

  it("parses output with empty buckets", () => {
    const data = {
      create: [],
      update: [],
      delete: [],
      reasoning: "No changes needed",
    };

    const result = ReconcileSubIssuesOutputSchema.parse(data);
    expect(result.create).toHaveLength(0);
  });
});

// ============================================================================
// buildPhaseIssueBody (moved from grooming.ts)
// ============================================================================

describe("buildPhaseIssueBody", () => {
  it("builds body with description only", () => {
    const body = buildPhaseIssueBody({
      phase_number: 1,
      title: "Setup",
      description: "Set up the project",
    });

    const md = serializeMarkdown(body);
    expect(md).toContain("## Description");
    expect(md).toContain("Set up the project");
    expect(md).not.toContain("## Affected Areas");
    expect(md).not.toContain("## Todo");
  });

  it("builds body with all sections", () => {
    const body = buildPhaseIssueBody({
      phase_number: 1,
      title: "Setup",
      description: "Set up the project",
      affected_areas: [
        { path: "src/index.ts", change_type: "modify", description: "Entry" },
      ],
      todos: [
        { task: "Install deps" },
        { task: "Configure build", manual: true },
      ],
    });

    const md = serializeMarkdown(body);
    expect(md).toContain("## Description");
    expect(md).toContain("## Affected Areas");
    expect(md).toContain("src/index.ts");
    expect(md).toContain("(modify)");
    expect(md).toContain("## Todo");
    expect(md).toContain("Install deps");
    expect(md).toContain("Configure build");
  });
});

// ============================================================================
// mergeTodos
// ============================================================================

describe("mergeTodos", () => {
  it("preserves checked state for matching todos", () => {
    const result = mergeTodos(
      [{ task: "Install deps" }, { task: "Write tests" }],
      [
        { text: "Install deps", checked: true },
        { text: "Write tests", checked: false },
      ],
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.checked).toBe(true);
    expect(result[1]?.checked).toBe(false);
  });

  it("adds new todos as unchecked", () => {
    const result = mergeTodos(
      [{ task: "New task" }],
      [{ text: "Old task", checked: true }],
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.text).toBe("New task");
    expect(result[0]?.checked).toBe(false);
    expect(result[1]?.text).toBe("Old task");
    expect(result[1]?.checked).toBe(true);
  });

  it("preserves existing todos not in new list", () => {
    const result = mergeTodos(
      [{ task: "Task A" }],
      [
        { text: "Task A", checked: false },
        { text: "Custom user task", checked: true },
      ],
    );

    expect(result).toHaveLength(2);
    expect(result[1]?.text).toBe("Custom user task");
    expect(result[1]?.checked).toBe(true);
  });

  it("handles case-insensitive matching via normalization", () => {
    const result = mergeTodos(
      [{ task: "Install Dependencies" }],
      [{ text: "install dependencies", checked: true }],
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.checked).toBe(true);
    expect(result[0]?.text).toBe("Install Dependencies");
  });

  it("handles empty inputs", () => {
    expect(mergeTodos([], [])).toHaveLength(0);
    expect(mergeTodos([{ task: "A" }], [])).toHaveLength(1);
    expect(mergeTodos([], [{ text: "B", checked: false }])).toHaveLength(1);
  });
});

// ============================================================================
// normalizeTodoText
// ============================================================================

describe("normalizeTodoText", () => {
  it("lowercases and trims", () => {
    expect(normalizeTodoText("  Hello World  ")).toBe("hello world");
  });

  it("collapses whitespace", () => {
    expect(normalizeTodoText("a   b  c")).toBe("a b c");
  });
});

// ============================================================================
// extractExistingTodos
// ============================================================================

describe("extractExistingTodos", () => {
  it("extracts checklist items from AST", () => {
    const ast = parseMarkdown("## Todo\n\n- [x] Done task\n- [ ] Pending task");
    const todos = extractExistingTodos(ast);

    expect(todos).toHaveLength(2);
    expect(todos[0]?.text).toBe("Done task");
    expect(todos[0]?.checked).toBe(true);
    expect(todos[1]?.text).toBe("Pending task");
    expect(todos[1]?.checked).toBe(false);
  });

  it("returns empty for no checklist", () => {
    const ast = parseMarkdown("## Description\n\nSome text.");
    const todos = extractExistingTodos(ast);

    expect(todos).toHaveLength(0);
  });
});

// ============================================================================
// extractSubIssueSpecs
// ============================================================================

describe("extractSubIssueSpecs", () => {
  it("extracts specs from sub-issues with phase titles", () => {
    const bodyAst = parseMarkdown(
      "## Description\n\nSetup auth module.\n\n## Todo\n\n- [ ] Create module\n- [x] Add config",
    );

    const specs = extractSubIssueSpecs([
      {
        number: 10,
        title: "[Phase 1]: Auth setup",
        bodyAst,
        state: "OPEN",
      },
    ]);

    expect(specs).toHaveLength(1);
    expect(specs[0]?.number).toBe(10);
    expect(specs[0]?.phase_number).toBe(1);
    expect(specs[0]?.title).toBe("Auth setup");
    expect(specs[0]?.description).toBe("Setup auth module.");
    expect(specs[0]?.todos).toHaveLength(2);
  });

  it("includes CLOSED sub-issues (no longer filters them out)", () => {
    const bodyAst = parseMarkdown("## Description\n\nDone.");

    const specs = extractSubIssueSpecs([
      {
        number: 10,
        title: "[Phase 1]: Done phase",
        bodyAst,
        state: "CLOSED",
        pr: { state: "MERGED" },
      },
      {
        number: 11,
        title: "[Phase 2]: Active phase",
        bodyAst,
        state: "OPEN",
      },
    ]);

    expect(specs).toHaveLength(2);
    expect(specs[0]?.number).toBe(10);
    expect(specs[0]?.state).toBe("CLOSED");
    expect(specs[0]?.merged).toBe(true);
    expect(specs[1]?.number).toBe(11);
    expect(specs[1]?.state).toBe("OPEN");
    expect(specs[1]?.merged).toBe(false);
  });

  it("filters out superseded sub-issues", () => {
    const bodyAst = parseMarkdown("## Description\n\nStale.");

    const specs = extractSubIssueSpecs([
      {
        number: 10,
        title: "[Phase 1]: Superseded phase",
        bodyAst,
        state: "CLOSED",
        labels: ["superseded"],
      },
      {
        number: 11,
        title: "[Phase 2]: Active phase",
        bodyAst,
        state: "OPEN",
        labels: [],
      },
    ]);

    expect(specs).toHaveLength(1);
    expect(specs[0]?.number).toBe(11);
  });

  it("sets merged=true for CLOSED sub-issues with MERGED PR", () => {
    const bodyAst = parseMarkdown("## Description\n\nCompleted.");

    const specs = extractSubIssueSpecs([
      {
        number: 10,
        title: "[Phase 1]: Completed",
        bodyAst,
        state: "CLOSED",
        pr: { state: "MERGED" },
      },
    ]);

    expect(specs).toHaveLength(1);
    expect(specs[0]?.merged).toBe(true);
  });

  it("sets merged=false for CLOSED sub-issues without merged PR", () => {
    const bodyAst = parseMarkdown("## Description\n\nAbandoned.");

    const specs = extractSubIssueSpecs([
      {
        number: 10,
        title: "[Phase 1]: Abandoned",
        bodyAst,
        state: "CLOSED",
        pr: null,
      },
    ]);

    expect(specs).toHaveLength(1);
    expect(specs[0]?.merged).toBe(false);
  });

  it("handles sub-issues without phase prefix", () => {
    const bodyAst = parseMarkdown("## Description\n\nSome work.");

    const specs = extractSubIssueSpecs([
      {
        number: 10,
        title: "Some plain title",
        bodyAst,
        state: "OPEN",
      },
    ]);

    expect(specs).toHaveLength(1);
    expect(specs[0]?.phase_number).toBe(0);
    expect(specs[0]?.title).toBe("Some plain title");
  });
});
