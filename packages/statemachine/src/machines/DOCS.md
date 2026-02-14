# Issue State Machine

The issue lifecycle state machine lives in `machines/issue-next-invoke/`. It determines what actions to take when GitHub events occur (issue assigned, CI completed, PR merged, etc.) and provides classes for prediction, execution, and verification.

## Directory Layout

```
machines/
├── issues/                      # Shared foundation
│   ├── actions.ts               # Compound action builders (transitionToReview, orchestrate, etc.)
│   ├── guards.ts                # 67 guard functions evaluating MachineContext
│   ├── states.ts                # 39 state constants (triaging, iterating, reviewing, etc.)
│   ├── events.ts                # 9 event types + trigger mapping
│   └── index.ts
├── issue-next-invoke/           # Production implementation
│   ├── machine.ts               # XState machine definition — syncAction() stubs
│   ├── services.ts              # Service names → buildActionsForService() mapper
│   ├── issue-machine.ts         # IssueMachine wrapper class (.predict(), .execute())
│   ├── context-loader.ts        # ContextLoader — builds MachineContext from GitHub API
│   ├── verifier.ts              # MachineVerifier — prediction + verification
│   └── index.ts
└── DOCS.md                      # This file
```

## Shared Foundation (`issues/`)

- **Guards** (`guards.ts`): 67 pure boolean functions that evaluate `MachineContext`. Examples: `needsTriage`, `isBotAssigned`, `hasCIFailed`, `allTodosDone`.
- **States** (`states.ts`): 39 frozen string constants like `triaging`, `iterating`, `reviewing`, `blocked`.
- **Events** (`events.ts`): Union type `IssueMachineEvent` with 9 variants (`DETECT`, `CI_PASSED`, `CI_FAILED`, etc.) plus `getTriggerEvent()` mapping triggers to initial events.
- **Compound action builders** (`actions.ts`): Functions like `transitionToReview()`, `handleCIFailure()`, `blockIssue()`, `orchestrate()`, `runClaude()` that take context and return `Action[]` arrays.

---

## IssueMachine

The main class for running the state machine. Wraps the XState machine and provides two modes: **predict** (synchronous, pure) and **execute** (async, calls real APIs).

### How It Works

The XState machine uses `syncAction(...serviceNames)` which calls `buildActionsForService()` synchronously and appends results to `context.pendingActions`:

```typescript
// In machine.ts — service names, resolved synchronously
logDetecting: syncAction("logDetecting"),
transitionToReview: syncAction("transitionToReview"),
```

The mapping function `buildActionsForService()` in `services.ts` is a switch over service names delegating to the compound action builders from `issues/actions.ts`.

### Context Shape

```typescript
MachineContext & { pendingActions: Action[] }
```

### API

```typescript
import { IssueNextInvoke } from "@more/statemachine";
const { IssueMachine } = IssueNextInvoke;

const machine = new IssueMachine(context, { logger: myLogger });

// Predict mode — synchronous, pure, no side effects
const result = machine.predict();
result.state;    // "iterating"
result.actions;  // [{ type: "createBranch", ... }, { type: "runClaude", ... }, ...]

// Execute mode — runs predict, then executes actions via runner
const execResult = await machine.execute({
  machineContext: context,
  runnerContext: { octokit, owner, repo, ... },
  runnerOptions: { dryRun: false },
});
execResult.state;         // "iterating"
execResult.actions;       // same as predict
execResult.runnerResult;  // { results: [...], terminated: false }
```

### Types

```typescript
interface RunOptions {
  machineContext: MachineContext;
}

interface MachineResult {
  state: string;
  actions: Action[];
}

interface ExecuteOptions extends RunOptions {
  runnerContext: RunnerContext;
  runnerOptions?: RunnerOptions;
}

interface ExecuteResult extends MachineResult {
  runnerResult: RunnerResult;
}
```

### Logger Injection

The `IssueMachine` accepts an optional `Logger` via the constructor:

```typescript
import type { Logger } from "../../core/types.js";
const machine = new IssueMachine(context, { logger: myLogger });
```

**16 pure log intents** (e.g., `logDetecting`, `logIterating`) produce only console output via the injected logger. **No `{ type: "log" }` actions ever appear in machine output.** Inline `actions.log.create()` calls from compound action builders are also filtered and routed to the logger.

---

## ContextLoader

Thin wrapper over `buildMachineContext()` from `parser/state-parser.ts`. Extracts the context-building logic from `deriveIssueActions()` into a clean interface.

### API

```typescript
import { IssueNextInvoke } from "@more/statemachine";
const { ContextLoader, buildDeriveMetadata } = IssueNextInvoke;

const loader = new ContextLoader();
const machineContext = await loader.load({
  octokit,
  owner: "my-org",
  repo: "my-repo",
  projectNumber: 42,
  maxRetries: 5,
  botUsername: "nopo-bot",
  trigger: "issue-assigned",
  event: githubEvent,
  // Optional enrichment
  commentContextType: "issue",
  commentContextDescription: "User requested review",
  branch: "claude/issue/123",
  ciRunUrl: "https://github.com/...",
  workflowStartedAt: "2026-01-01T00:00:00Z",
  workflowRunUrl: "https://github.com/...",
});

// After running the machine, build DeriveResult metadata
const metadata = buildDeriveMetadata(machineContext, machineResult);
// metadata.iteration, metadata.phase, metadata.parentIssueNumber, etc.
```

### Types

```typescript
interface ContextLoaderOptions {
  octokit: OctokitLike;
  owner: string;
  repo: string;
  projectNumber: number;
  maxRetries: number;
  botUsername: string;
  trigger: TriggerType;
  event: GitHubEvent;
  commentContextType?: "issue" | "pr" | null;
  commentContextDescription?: string | null;
  branch?: string | null;
  ciRunUrl?: string | null;
  workflowStartedAt?: string;
  workflowRunUrl?: string | null;
}

interface DeriveMetadata {
  iteration: number;
  phase: number | null;
  parentIssueNumber: number | null;
  subIssueNumber: number | null;
  prNumber: number | null;
  commitSha: string | null;
  agentNotes: string | null;
}
```

---

## MachineVerifier

Consolidates prediction and verification logic. Replaces the scattered logic across `verify/predict.ts`, `verify/predictable-state.ts`, `verify/compare.ts`, and `sm-plan/lib/expected-state.ts`.

### API

```typescript
import { IssueNextInvoke } from "@more/statemachine";
const { MachineVerifier } = IssueNextInvoke;

const verifier = new MachineVerifier();

// 1. After running the machine, predict expected post-execution state
const expected = verifier.predictExpectedState(machineResult, machineContext);
// expected.outcomes = [tree1, tree2, ...]  (multiple for non-deterministic actions)
// expected.expectedRetrigger = true/false

// 2. After execution, extract actual state tree
const actualTree = verifier.extractStateTree(postExecutionContext);

// 3. Compare
const verification = verifier.verify(expected, actualTree, actualRetrigger);
// verification.pass           — overall pass/fail
// verification.result         — detailed comparison with diffs
// verification.retriggerPass  — whether retrigger matched
```

### Prediction Engine

The prediction engine folds action-level predictors:

```typescript
// Each action definition has an optional predict() function:
closeIssue: defAction(schema, {
  predict: () => ({ target: { state: "CLOSED" } }),
  execute: async (action, ctx) => { /* real GitHub API call */ },
});

// predictFromActions() applies each predictor to the state tree:
// createBranch.predict → { target: { hasBranch: true } }
// createPR.predict     → { target: { hasPR: true }, issue: { pr: { isDraft: true } } }
// runClaude.predict    → [ { target: { body: { hasTodos: true } } },   // outcome A
//                          { target: { body: { hasTodos: false } } } ]  // outcome B (fork)
```

**Why multiple outcomes?** Non-deterministic actions (like `runClaude`) can produce different results. The prediction forks into N possible state trees. Verification passes if the actual state matches **any** predicted outcome.

### Retrigger Prediction

```typescript
verifier.predictRetrigger(finalState);
// Returns true for: orchestrationRunning, triaging, resetting, prReviewAssigned
```

These states need the workflow to retrigger after execution completes.

---

## Execution Lifecycle

The machine follows a five-phase lifecycle, mapped to three GitHub Actions:

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ 1. Load      │───>│ 2. Predict   │───>│ 3. Execute   │───>│ 4. Update GH │───>│ 5. Verify    │
│    Context   │    │    (sm-plan) │    │    (sm-run)  │    │    Resource  │    │    (sm-verify)│
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

| GitHub Action | Phase | What it does |
|---------------|-------|-------------|
| `sm-plan` | 1 + 2 | Load context, run machine, predict expected post-state |
| `sm-run` | 3 + 4 | Execute actions, update issue history |
| `sm-verify` | 5 | Compare actual state against predictions |

### Class-Based Flow

```typescript
// sm-plan
const loader = new ContextLoader();
const machineContext = await loader.load(options);
const machine = new IssueMachine(machineContext);
const result = machine.predict();
const verifier = new MachineVerifier();
const expected = verifier.predictExpectedState(result, machineContext);
const metadata = buildDeriveMetadata(machineContext, result);

// sm-run
const execResult = await machine.execute({
  machineContext,
  runnerContext: { octokit, owner, repo, ... },
});

// sm-verify
const actualTree = verifier.extractStateTree(postContext);
const verification = verifier.verify(expected, actualTree, actualRetrigger);
```

### Phase 1: Load Context

Build a `MachineContext` from the GitHub API via `ContextLoader.load()`:

```typescript
const context = await loader.load({
  octokit, owner, repo, projectNumber,
  trigger, event, maxRetries, botUsername,
});
```

Key data in `MachineContext`:

```typescript
{
  issue: { number, state, projectStatus, iteration, failures, labels, ... },
  pr: { number, isDraft, state, ciStatus, reviewDecision, ... } | null,
  parentIssue: { ... } | null,
  subIssues: [{ number, projectStatus, hasPR, ... }],
  currentPhase: number | null,
  currentSubIssue: { ... } | null,
  trigger: "issue-assigned" | "workflow-run-completed" | "pr-merged" | ...,
  // ... ~40 fields total
}
```

### Phase 2: Predict (sm-plan)

```typescript
const machine = new IssueMachine(context);
const result = machine.predict();
// result.state = "iterating"
// result.actions = [{ type: "createBranch", ... }, { type: "runClaude", ... }, ...]

const expected = verifier.predictExpectedState(result, context);
// expected.outcomes = [tree1, tree2, ...]
```

### Phase 3: Execute (sm-run)

```typescript
const execResult = await machine.execute({
  machineContext: context,
  runnerContext: { octokit, owner, repo, ... },
});
// execResult.runnerResult.results = [{ action, success, error? }, ...]
```

The runner (`executeActions()`) loops through each action:
- Validates against the action schema
- Calls `def.execute(action, ctx, chainCtx)` for the real API call
- Passes chain context between sequential actions (e.g., `runClaude` output → `applyGroomingOutput`)
- Halts on terminal actions (`stop`, `block`)

### Phase 4: Update GitHub Resource

After execution, `sm-run` updates the issue's history section via `parseIssue()` + mdast manipulation.

### Phase 5: Verify (sm-verify)

```typescript
const actualTree = verifier.extractStateTree(postContext);
const verification = verifier.verify(expected, actualTree, actualRetrigger);

if (verification.pass) {
  // ✅ Matched one of the predicted outcomes
} else {
  // ❌ Block the issue, unassign bot
}
```

**What gets compared:**

| Field | Rule |
|-------|------|
| `issue.state` | exact match |
| `issue.projectStatus` | exact match |
| `issue.iteration` | actual >= expected |
| `issue.failures` | exact or 0 |
| `issue.labels` | expected subset of actual |
| `issue.assignees` | expected subset of actual |
| `issue.hasBranch` | enforced only when expected=true |
| `issue.hasPR` | enforced only when expected=true |
| `pr.isDraft` | exact match |
| `body.hasDescription` | enforced only when expected=true |
| `body.historyEntries` | each expected entry must be present |
| Sub-issue fields | same rules per sub-issue |
