# Grooming System Interfaces

This document provides detailed TypeScript interface definitions and API contracts for the grooming system.

## Table of Contents

- [Agent Outputs](#agent-outputs)
- [Summary Output](#summary-output)
- [Sub-Issue Specifications](#sub-issue-specifications)
- [State Machine Actions](#state-machine-actions)
- [Question Types](#question-types)
- [Error Types](#error-types)

## Agent Outputs

### Base Agent Output

All grooming agents (PM, Engineer, QA, Research) return this base structure:

```typescript
interface GroomingAgentOutput {
  ready: boolean;         // Can proceed from this agent's perspective?
  questions?: string[];   // Unresolved questions from this agent
}
```

**Schema**: `GroomingAgentOutputSchema` (with `.passthrough()` for agent-specific fields)

**Validation**: Uses Zod for runtime validation. Invalid output triggers fallback behavior.

### PM Agent Output

```typescript
interface PMOutput extends GroomingAgentOutput {
  ready: boolean;
  questions?: string[];
}
```

**Example**:
```json
{
  "ready": false,
  "questions": [
    "What is the expected user impact of this change?",
    "Should this be prioritized over the authentication refactor?"
  ]
}
```

### Engineer Agent Output

```typescript
interface EngineerOutput extends GroomingAgentOutput {
  ready: boolean;
  questions?: string[];
  recommended_phases: SubIssueSpec[];  // How to break down the work
}
```

**Schema**: `EngineerOutputSchema`

**Example**:
```json
{
  "ready": true,
  "recommended_phases": [
    {
      "phase_number": 1,
      "title": "Database schema changes",
      "description": "Add new tables and migrations",
      "affected_areas": [
        {
          "path": "apps/backend/src/models/user.py",
          "change_type": "modify",
          "description": "Add email_verified field"
        }
      ],
      "todos": [
        { "task": "Create migration", "manual": false },
        { "task": "Update model", "manual": false }
      ],
      "depends_on": []
    },
    {
      "phase_number": 2,
      "title": "API endpoints",
      "description": "Implement verification endpoints",
      "depends_on": [1]
    }
  ]
}
```

### QA Agent Output

```typescript
interface QAOutput extends GroomingAgentOutput {
  ready: boolean;
  questions?: string[];
}
```

**Example**:
```json
{
  "ready": false,
  "questions": [
    "How should we test the email verification flow end-to-end?",
    "Are there any edge cases with expired verification tokens?"
  ]
}
```

### Research Agent Output

```typescript
interface ResearchOutput extends GroomingAgentOutput {
  ready: boolean;
  questions?: string[];
}
```

**Example**:
```json
{
  "ready": true,
  "questions": []
}
```

### Combined Grooming Output

The output from all 4 agents running in parallel:

```typescript
interface CombinedGroomingOutput {
  pm: GroomingAgentOutput;
  engineer: GroomingAgentOutput;
  qa: GroomingAgentOutput;
  research: GroomingAgentOutput;
}
```

**Schema**: `CombinedGroomingOutputSchema`

**Example**:
```json
{
  "pm": { "ready": true },
  "engineer": {
    "ready": true,
    "recommended_phases": [...]
  },
  "qa": { "ready": false, "questions": ["How to test?"] },
  "research": { "ready": true }
}
```

## Summary Output

The summary agent consolidates all agent outputs into a final decision:

```typescript
interface GroomingSummaryOutput {
  summary: string;                          // Overall assessment
  consensus?: string[];                     // Points of agreement
  conflicts?: {                             // Points of disagreement
    issue: string;
    resolution: string;
  }[];
  decision: "ready" | "needs_info" | "blocked";
  decision_rationale: string;               // Why this decision
  consolidated_questions?: ConsolidatedQuestion[];
  answered_questions?: AnsweredQuestion[];
  blocker_reason?: string;                  // If blocked, why?
  next_steps?: string[];                    // Recommended actions
  agent_notes?: string[];                   // Notes for history
}
```

**Schema**: `GroomingSummaryOutputSchema`

**Decision Logic**:
- **ready**: All agents `ready: true` → proceed to implementation
- **needs_info**: One or more agents have `questions` → wait for answers
- **blocked**: External blocker identified → requires human intervention

**Example (needs_info)**:
```json
{
  "summary": "Issue needs clarification on authentication strategy and test plan.",
  "decision": "needs_info",
  "decision_rationale": "QA agent has unresolved testing questions, and Engineer needs clarity on OAuth vs JWT.",
  "consolidated_questions": [
    {
      "id": "auth-strategy",
      "title": "OAuth vs JWT?",
      "description": "Which authentication method should we use?",
      "sources": ["pm", "engineer"],
      "priority": "critical"
    },
    {
      "id": "test-coverage",
      "title": "E2E test approach?",
      "description": "How should we test the full verification flow?",
      "sources": ["qa"],
      "priority": "important"
    }
  ]
}
```

**Example (ready)**:
```json
{
  "summary": "All agents agree the issue is ready for implementation.",
  "consensus": [
    "Clear requirements",
    "Technical approach validated",
    "Test strategy defined"
  ],
  "decision": "ready",
  "decision_rationale": "All agents ready, engineer provided phase breakdown.",
  "next_steps": [
    "Create sub-issues for phases",
    "Assign nopo-bot to Phase 1"
  ]
}
```

**Example (blocked)**:
```json
{
  "summary": "Blocked on external API credentials.",
  "decision": "blocked",
  "decision_rationale": "Cannot implement without third-party API access.",
  "blocker_reason": "Waiting on SendGrid API key from ops team (ticket #1234)"
}
```

## Sub-Issue Specifications

### SubIssueSpec

Defines a phase of work to be created as a sub-issue:

```typescript
interface SubIssueSpec {
  phase_number: number;                // 1-based phase number
  title: string;                       // Phase title (without "[Phase N]:" prefix)
  description: string;                 // Phase description (markdown)
  affected_areas?: AffectedArea[];     // Files to change
  todos?: TodoItem[];                  // Task checklist
  depends_on?: number[];               // Other phase numbers (dependencies)
}
```

**Schema**: `SubIssueSpecSchema`

**Usage**:
- Returned by Engineer agent in `recommended_phases`
- Passed to sub-issue reconciliation
- Used to build sub-issue bodies

### AffectedArea

```typescript
interface AffectedArea {
  path: string;                        // File path
  change_type?: string;                // "add" | "modify" | "delete"
  description?: string;                // What changes
  impact?: string;                     // Impact description
}
```

**Example**:
```json
{
  "path": "apps/backend/src/auth/verify.py",
  "change_type": "add",
  "description": "New email verification module",
  "impact": "Adds new endpoint for email verification"
}
```

### TodoItem

```typescript
interface TodoItem {
  task: string;                        // Task description
  manual?: boolean;                    // Requires manual action?
}
```

**Manual tasks**: Prefixed with `[Manual]` in issue body, trigger `waiting_manual` state when reached.

**Example**:
```json
[
  { "task": "Create database migration" },
  { "task": "Add API endpoint" },
  { "task": "Update OpenAPI spec", "manual": true }
]
```

### ExistingSubIssue

Extends `SubIssueSpec` with GitHub issue state:

```typescript
interface ExistingSubIssue extends SubIssueSpec {
  number: number;                      // GitHub issue number
  state?: string;                      // "OPEN" | "CLOSED"
  merged?: boolean;                    // PR merged?
}
```

**Schema**: `ExistingSubIssueSchema`

**Usage**: Input to sub-issue reconciliation (compares existing vs recommended)

## State Machine Actions

### RunClaudeGroomingAction

Triggers parallel grooming agents:

```typescript
interface RunClaudeGroomingAction {
  type: "run-claude-grooming";
  issueNumber: number;
  promptVars?: Record<string, string>;  // Variables for prompt templates
}
```

**Executor**: `executeRunClaudeGrooming`

**Returns**: `{ outputs: CombinedGroomingOutput }`

### ApplyGroomingOutputAction

Applies grooming results to the issue:

```typescript
interface ApplyGroomingOutputAction {
  type: "apply-grooming-output";
  issueNumber: number;
  filePath?: string;                    // Path to JSON output file (optional)
}
```

**Executor**: `executeApplyGroomingOutput`

**Returns**:
```typescript
{
  applied: boolean;
  decision: "ready" | "needs_info" | "blocked";
  recommendedPhases?: SubIssueSpec[];   // If ready + engineer recommended phases
}
```

**Side effects**:
- Updates issue body Questions section
- Adds agent notes to history
- Adds 'groomed' label (if ready)
- Does NOT create sub-issues (that's handled by separate reconciliation action)

## Question Types

### ConsolidatedQuestion

A question identified by grooming agents, with stable ID:

```typescript
interface ConsolidatedQuestion {
  id: string;                           // Unique slug (e.g., "auth-strategy")
  title: string;                        // Short question (≤60 chars)
  description: string;                  // Full question context
  sources: AgentType[];                 // Which agents asked this
  priority: "critical" | "important" | "nice-to-have";
}

type AgentType = "pm" | "engineer" | "qa" | "research";
```

**ID format**: Kebab-case slug derived from question content (e.g., "oauth-vs-jwt")

**Priority semantics**:
- **critical**: Blocks all work, must answer before proceeding
- **important**: Should answer before starting, but can proceed with assumptions
- **nice-to-have**: Clarification would help, but not required

**Markdown format**:
```markdown
- [ ] **OAuth vs JWT?** **[critical]** - Which authentication method should we use? _(pm, engineer)_ `id:auth-strategy`
```

### AnsweredQuestion

A previously asked question that was answered:

```typescript
interface AnsweredQuestion {
  id: string;                           // Matches ConsolidatedQuestion.id
  title: string;                        // Original question
  answer_summary: string;               // How it was answered
}
```

**Markdown format**:
```markdown
- [x] ~~Which auth method to use?~~ - Decided OAuth based on comment #5 `id:auth-strategy`
```

### QuestionItem

Parsed from issue body (internal type):

```typescript
interface QuestionItem {
  id: string | null;                    // null for triage questions (no ID)
  text: string;                         // Full markdown text
  checked: boolean;                     // Checkbox state
}
```

**Usage**: Extracted from issue body AST to preserve user-checked state during re-runs.

## Error Types

### Agent Failure Response

When an agent fails to complete:

```typescript
{
  ready: false,
  questions: [`Agent ${agentName} failed to complete analysis`]
}
```

**Handling**: Summary agent treats this as `needs_info` with diagnostic question.

### Validation Error

When structured output doesn't match schema:

```typescript
throw new Error(
  `Invalid ${label} output:\n${issues}\nData: ${JSON.stringify(data)}`
);
```

**Zod validation** provides detailed error messages with paths (e.g., `pm.questions: Expected array, got string`).

### Fallback Summary

When summary agent fails, use fallback:

```typescript
interface FallbackSummary extends GroomingSummaryOutput {
  summary: "Grooming summary prompt failed, showing raw agent questions.";
  decision: "needs_info";
  consolidated_questions: ConsolidatedQuestion[];  // From raw agent questions
}
```

**Fallback logic**:
1. Collect all `questions` arrays from all agents
2. Assign sequential IDs: `fallback-0`, `fallback-1`, etc.
3. Set priority to `important`
4. Use question text as both `title` and `description`

## API Contracts

### Grooming Executor Chain

```typescript
// 1. Run grooming agents in parallel
const { outputs } = await executeRunClaudeGrooming(action, ctx);
// outputs: CombinedGroomingOutput

// 2. Apply grooming output (runs summary agent internally)
const result = await executeApplyGroomingOutput(
  { type: "apply-grooming-output", issueNumber },
  ctx,
  outputs  // Pass structured output from step 1
);
// result: { applied, decision, recommendedPhases? }
```

### Question Lifecycle

```typescript
// Extract existing questions from issue body
const existingQuestions = extractQuestionItems(issueBodyAst);
// QuestionItem[]

// Run summary to get consolidated + answered questions
const summary = await runGroomingSummary(...);
// GroomingSummaryOutput

// Build new Questions section, preserving user-checked state
const content = buildQuestionsContent(summary, existingQuestions);
// RootContent[] (MDAST nodes)

// Upsert into issue body
const updatedData = upsertSection({ title: "Questions", content }, data);
```

### Sub-Issue Body Construction

```typescript
// Build MDAST for sub-issue body
const bodyAst = buildPhaseIssueBody(spec);
// Root (MDAST)

// Serialize to markdown
const bodyMarkdown = serializeMarkdown(bodyAst);
// string

// Create GitHub issue
await octokit.rest.issues.create({
  title: `[Phase ${spec.phase_number}]: ${spec.title}`,
  body: bodyMarkdown,
  labels: ["phase", `phase-${spec.phase_number}`],
});
```

## Versioning and Compatibility

### Schema Evolution

All schemas use Zod for runtime validation. When evolving schemas:

1. **Additive changes** (new optional fields) → Safe, no migration needed
2. **Required fields** → Requires prompt updates + testing
3. **Removed fields** → Use `.passthrough()` for backwards compatibility
4. **Renamed fields** → Breaks compatibility, requires version bump

### Prompt-Schema Alignment

Each grooming agent has a corresponding prompt with `output_schema.json`:

```
packages/prompts/src/grooming/
├── pm/
│   ├── main.txt
│   └── output_schema.json        # Must match GroomingAgentOutputSchema
├── engineer/
│   ├── main.txt
│   └── output_schema.json        # Must match EngineerOutputSchema
├── summary/
│   ├── main.txt
│   └── output_schema.json        # Must match GroomingSummaryOutputSchema
```

**Testing**: `check-prompt-schemas.yml` validates prompt schemas match TypeScript types.

## Type Guards

### Decision Type Guards

```typescript
function isReady(output: GroomingSummaryOutput): output is GroomingSummaryOutput & { decision: "ready" } {
  return output.decision === "ready";
}

function isNeedsInfo(output: GroomingSummaryOutput): boolean {
  return output.decision === "needs_info" &&
         (output.consolidated_questions?.length ?? 0) > 0;
}

function isBlocked(output: GroomingSummaryOutput): output is GroomingSummaryOutput & { blocker_reason: string } {
  return output.decision === "blocked";
}
```

### Question Type Guards

```typescript
function hasQuestions(agent: GroomingAgentOutput): boolean {
  return (agent.questions?.length ?? 0) > 0;
}

function isCritical(question: ConsolidatedQuestion): boolean {
  return question.priority === "critical";
}
```

## Examples

### Full Grooming Flow

```typescript
// 1. Run grooming
const groomingAction: RunClaudeGroomingAction = {
  type: "run-claude-grooming",
  issueNumber: 123,
  promptVars: {
    ISSUE_NUMBER: "123",
    ISSUE_TITLE: "Add email verification",
    ISSUE_BODY: "...",
  },
};

const { outputs } = await executeRunClaudeGrooming(groomingAction, ctx);

// 2. Apply results
const applyAction: ApplyGroomingOutputAction = {
  type: "apply-grooming-output",
  issueNumber: 123,
};

const result = await executeApplyGroomingOutput(applyAction, ctx, outputs);

// 3. Handle decision
if (result.decision === "ready") {
  // Proceed to sub-issue reconciliation if phases recommended
  if (result.recommendedPhases && result.recommendedPhases.length > 0) {
    await reconcileSubIssues({
      type: "reconcile-sub-issues",
      issueNumber: 123,
      recommendedPhases: result.recommendedPhases,
    }, ctx);
  }
} else if (result.decision === "needs_info") {
  // Questions added to issue body, wait for human answers
  console.log("Waiting for answers to questions");
} else {
  // Blocked, requires intervention
  console.log(`Blocked: ${result.blocker_reason}`);
}
```

### Question Re-run Scenario

```typescript
// Initial grooming run
const summary1 = {
  decision: "needs_info",
  consolidated_questions: [
    {
      id: "auth-strategy",
      title: "OAuth vs JWT?",
      description: "Which auth method?",
      sources: ["pm", "engineer"],
      priority: "critical",
    },
  ],
};

// User checks off question in issue body after discussing in comments
// Re-run grooming

const summary2 = {
  decision: "ready",
  answered_questions: [
    {
      id: "auth-strategy",
      title: "OAuth vs JWT?",
      answer_summary: "Decided OAuth based on comment #5",
    },
  ],
};

// buildQuestionsContent preserves the checked state and marks as answered
```
