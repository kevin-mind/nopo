# Issue State Machine

The issue lifecycle state machine lives in `machines/issue-next-invoke/`. It determines what actions to take when GitHub events occur (issue assigned, CI completed, PR merged, etc.) and provides classes for prediction, execution, and verification.

---

## Example PEV machine and Machine Factory

The **example** machine (`machines/example/`) is a minimal PEV (predict–execute–verify) domain machine built with the **machine factory** from core. It demonstrates the single-level, type-safe API and is the reference for reimplementing the issues machine.

### Layout (example)

```
machines/example/
├── index.ts      # Barrel export
├── machine.ts    # createMachineFactory + createDomainMachine
├── context.ts    # ExampleContext + ExampleContextLoader (extract/load/mutate/save)
├── actions.ts    # Atomic action builders
├── guards.ts     # Atomic guard functions
└── states.ts     # Atomic state parts (routing, queue assigners, static states)
```

- **No imports** from `machines/issues` or `machines/discussions`. Example is self-contained; context and guards are reimplemented locally.
- **Core** (`src/core/pev/`) does not import from outside core.

### Machine factory API (core)

Use `createMachineFactory<TDomain>()` to get a stateful factory, then configure and build:

```ts
const factory = createMachineFactory<ExampleContext>()
  .actions((createAction) => ({ ... }))   // compose actions explicitly
  .guards(() => ({ ... }))                // compose guards explicitly
  .states(({ registry }) => ({ ... })) // compose states explicitly from atomic parts
  .refreshContext(ExampleContextLoader.refreshFromRunnerContext);

const machine = factory.build({ id: "example" });
```

- **Actions**: call `.actions(build)` with a function that receives `createAction` and returns an object of action definitions. Payload types are inferred from `createAction<Payload>({ ... })`.
- **Guards**: call `.guards(build)` with a function that returns a guards object. Guard functions receive `{ context: RunnerMachineContext<TDomain, TAction> }`; `TAction` is inferred from the action registry.
- **Guard style note**: XState supports both named guards (`guard: "isBlocked"`) and inline guards (`guard: ({ context }) => ...`). We standardize on **named guard functions** because they are easier to reuse across transitions, easier to unit test as pure functions, and keep large routing tables readable.
- **States**: call `.states(s)` with a domain states object, or `.states(({ registry }) => s)` when states depend on the typed action registry.
- **Build**: call `.build({ id })` to build the machine directly from configured parts.

### Declarative prediction checks

Actions can declare postconditions in `predict.checks`. The runner evaluates these checks during verify, and they are enforced even when a custom `verify` function is defined.

Actions can also define a top-level `description` field. The runner logs this description before execute. Use `predict` only when you need declarative checks (or additional prediction metadata), not just to emit a description.

`predict.expectedChanges` is removed; declarative postconditions are expressed only via `predict.checks`.

```ts
predict: () => ({
  description: "Apply triage output",
  checks: [
    {
      comparator: "all",
      checks: [
        { comparator: "includes", field: "issue.labels", expected: "triaged" },
        { comparator: "includes", field: "issue.labels", expected: "groomed" },
      ],
    },
  ],
});
```

#### Check shape

- **Leaf checks** use `field` + `comparator` (+ `expected` when required).
- **Leaf checks** can include optional `description` to explain intent and improve failure diagnostics.
- **Group checks** use `comparator: "all" | "any"` and nested `checks`.
- **Source** can be selected with `from: "old" | "new"` (default is `"new"`).

#### Comparators

- `eq`: deep equality (`expected` required)
- `gte`: numeric greater-than-or-equal (`expected: number` required)
- `lte`: numeric less-than-or-equal (`expected: number` required)
- `subset`: `expected[]` must be a subset of actual array (`expected: unknown[]` required)
- `includes`: actual array/string includes expected value (`expected` required)
- `exists`: value at `field` is not `null`/`undefined` (`expected` not allowed)
- `startsWith`: actual string starts with expected prefix (`expected: string` required)
- `all`: all child checks must pass (`checks` required)
- `any`: at least one child check must pass (`checks` required)

#### Verify integration

Custom `verify` receives an object with:

- `action`, `oldCtx`, `newCtx`
- `prediction`
- `predictionEval` (pass + diffs from declarative checks)
- `predictionDiffs` (prebuilt failing check diffs for direct reuse)
- `executeResult`

This lets `verify` add domain-specific messaging while declarative checks remain the canonical contract.

### Testing

Integration tests live in `tests/pev/example-machine.test.ts` and use only **example** and **core** imports. Fixtures are built from `tests/pev/mock-factories.ts`.

### Queue Builder Patterns

Queue builders are plain TypeScript functions with the signature:

```ts
function buildXxxQueue(
  context: RunnerMachineContext<ExampleContext, ExampleAction>,
  registry: ExampleRegistry,
): ExampleAction[]
```

Each builder receives the full runner context (including `context.domain` for the domain model) and the typed action registry. It returns an ordered `ExampleAction[]` array that becomes the `actionQueue` for the state.

#### Assigner wrapping

Builders are never called directly from the machine. Instead, each builder is wrapped in an XState `assign` call so the queue is set atomically when a state is entered:

```ts
const assignIterateQueue = assign<Ctx, AnyEventObject, undefined, EventObject, never>({
  actionQueue: ({ context }) => buildIterateQueue(context, registry),
});
```

`createExampleQueueAssigners(registry)` collects all assigners and returns them as a named object. The machine imports only the assigner object, never the raw builder functions.

#### Conditional queue composition

Some builders accumulate a `prelude` array before the fixed tail of the queue. This lets a single builder cover multiple triggers without duplicating the core action sequence.

**`buildIterateQueue` — CI-failure and review-changes preludes:**

```ts
function buildIterateQueue(
  context: Ctx,
  registry: ExampleRegistry,
  mode: "iterate" | "retry" = "iterate",
): ExampleAction[] {
  const issueNumber =
    context.domain.currentSubIssue?.number ?? context.domain.issue.number;
  const prelude: ExampleAction[] = [];

  // CI-failure prelude: record the failure and log context before iterating
  if (context.domain.ciResult === "failure") {
    prelude.push(
      registry.recordFailure.create({ issueNumber, failureType: "ci" }),
      registry.appendHistory.create({
        issueNumber,
        message: "CI failed, returning to iteration",
        phase: "iterate",
      }),
    );
  }

  // Review-changes prelude: log context when reviewer requested changes
  if (context.domain.reviewDecision === "CHANGES_REQUESTED") {
    prelude.push(
      registry.appendHistory.create({
        issueNumber,
        message: "Review requested changes, returning to iteration",
        phase: "review",
      }),
    );
  }

  return [
    ...prelude,
    registry.updateStatus.create({ issueNumber, status: "In progress" }),
    registry.appendHistory.create({
      issueNumber,
      message: mode === "retry" ? "Fixing CI" : "Starting iteration",
    }),
    registry.runClaudeIteration.create({ issueNumber, mode, promptVars: { /* ... */ } }),
    registry.applyIterationOutput.create({ issueNumber }),
  ];
}
```

**`buildReviewQueue` — COMMENTED prelude:**

```ts
function buildReviewQueue(context: Ctx, registry: ExampleRegistry): ExampleAction[] {
  const issueNumber =
    context.domain.currentSubIssue?.number ?? context.domain.issue.number;

  // When a reviewer left a comment (not approval/changes), log it before requesting review
  const prelude: ExampleAction[] =
    context.domain.reviewDecision === "COMMENTED"
      ? [
          registry.appendHistory.create({
            issueNumber,
            message: "Review commented, staying in review",
            phase: "review",
          }),
        ]
      : [];

  return [
    ...prelude,
    registry.updateStatus.create({ issueNumber, status: "In review" }),
    registry.appendHistory.create({ issueNumber, message: "Requesting review" }),
  ];
}
```

#### `recordFailure` + circuit breaker integration

`recordFailure` increments `issue.failures` in the domain model. It carries a `predict` check so the runner can verify the counter was incremented before continuing:

```ts
// In actions.ts
export function recordFailureAction(createAction: ExampleCreateAction) {
  return createAction<{ issueNumber: number; failureType: "ci" | "review" }>({
    predict: (action, ctx) => {
      const current = /* resolve issue or sub-issue */.failures ?? 0;
      return {
        checks: [{ comparator: "eq", field: "issue.failures", expected: current + 1 }],
      };
    },
    execute: async (action, ctx) => {
      const issue = /* resolve */;
      Object.assign(issue, { failures: (issue.failures ?? 0) + 1 });
      return { ok: true };
    },
  });
}
```

The circuit breaker lives in `guards.ts` as `maxFailuresReached`:

```ts
function maxFailuresReached({ context }: GuardArgs): boolean {
  const failures = context.domain.issue.failures ?? 0;
  const max = context.domain.maxRetries ?? 3;
  return failures >= max;
}
```

When `triggeredByCIAndShouldBlock` fires (CI trigger + `maxFailuresReached`), the machine routes to the `blocking` state whose assigner uses `buildBlockQueue`:

```ts
function buildBlockQueue(context: Ctx, registry: ExampleRegistry): ExampleAction[] {
  const failures = (context.domain.currentSubIssue ?? context.domain.issue).failures ?? 0;
  return [
    registry.updateStatus.create({ issueNumber, status: "Blocked" }),
    registry.appendHistory.create({
      issueNumber,
      message: `Blocked: Max failures reached (${failures})`,
      phase: "iterate",
    }),
  ];
}
```

The typical CI-failure flow is therefore:

```
CI failure trigger
  → triggeredByCIAndShouldBlock?  yes → blocking (buildBlockQueue)
  → triggeredByCIAndShouldContinue? yes → iterating (buildIterateQueue with ciResult prelude)
```

#### Orchestration conditional patterns

Several builders inspect parent/sub-issue relationships to decide what extra actions to append.

**`buildMergeQueue` — conditional orchestration tail:**

```ts
function buildMergeQueue(context: Ctx, registry: ExampleRegistry): ExampleAction[] {
  const queue: ExampleAction[] = [
    registry.updateStatus.create({ issueNumber, status: "Done" }),
    registry.appendHistory.create({ issueNumber, message: "PR merged, issue marked done", phase: "review" }),
    registry.persistState.create({ issueNumber, reason: "merge-complete" }),
  ];

  // Only run orchestration when this issue is part of a parent/sub-issue hierarchy
  const needsOrchestration =
    context.domain.parentIssue !== null || context.domain.issue.hasSubIssues;
  if (needsOrchestration) {
    const parentNumber =
      context.domain.parentIssue?.number ?? context.domain.issue.number;
    queue.push(
      registry.runOrchestration.create({ issueNumber: parentNumber, initParentIfNeeded: false }),
      registry.appendHistory.create({ issueNumber: parentNumber, message: "Orchestration command processed" }),
    );
  }
  return queue;
}
```

**`buildOrchestrateQueue` — status-driven `initParentIfNeeded`:**

```ts
function buildOrchestrateQueue(context: Ctx, registry: ExampleRegistry): ExampleAction[] {
  const status = context.domain.issue.projectStatus;
  // Initialize the parent issue only when it has not yet been started
  const initParentIfNeeded = status === null || status === "Backlog";
  return [
    registry.runOrchestration.create({ issueNumber, initParentIfNeeded }),
    registry.appendHistory.create({ issueNumber, message: "Orchestration command processed" }),
  ];
}
```

**`buildInitializingQueue`** always passes `initParentIfNeeded: true` because it fires when a parent issue has just been assigned and sub-issues need to be initialized:

```ts
function buildInitializingQueue(context: Ctx, registry: ExampleRegistry): ExampleAction[] {
  return [
    registry.runOrchestration.create({ issueNumber, initParentIfNeeded: true }),
    registry.appendHistory.create({ issueNumber, message: "Initializing" }),
  ];
}
```

The difference between `buildInitializingQueue` and `buildOrchestrateQueue` is intent: `initializing` runs on first assignment (always needs parent setup), while `orchestrating` runs on subsequent events (only initializes parent when the project status shows it has not yet started).

### Sprint 1 additions: trigger normalization + routing skeleton

- `machines/example/events.ts`
  - Canonical trigger list (`EXAMPLE_TRIGGER_TYPES`)
  - Trigger-to-machine event resolution (`getTriggerEvent`)
  - Workflow input normalization (`buildEventFromWorkflow`)
- `machines/example/context.ts`
  - `ExampleContextLoader` loads issue-state from GitHub (`parseIssue`) and exposes typed extractor/mutator methods
  - `toContext()` composes runtime domain context from extracted issue/sub-issue/PR/workflow data
  - `toState()` / `save()` mutate and persist issue-state updates for action execution flows
- `machines/example/states.ts`
  - Expanded DETECT routing skeleton covering all issue/PR/CI/release trigger families
  - Placeholder states for non-implemented vertical slices (to be filled in sprint-by-sprint)
- Tests:
  - `tests/pev/example-events-routing.test.ts` validates trigger mapping + routing skeleton

### Sprint 2 additions: triage + grooming vertical slice

- `machines/example/actions.ts`
  - Added explicit triage/groom actions in PEV style:
    - `runClaudeTriage`, `applyTriageOutput`
    - `runClaudeGrooming`, `applyGroomingOutput`, `reconcileSubIssues`
  - Each action carries predict/execute/verify callbacks with the new signature.
- `machines/example/states.ts`
  - `triaging` now enqueues triage queue:
    `appendHistory -> runClaudeTriage -> applyTriageOutput -> updateStatus`
  - `grooming` now enqueues grooming queue:
    `appendHistory -> runClaudeGrooming -> applyGroomingOutput -> reconcileSubIssues`
- `machines/example/guards.ts`
  - `needsTriage` aligned to domain behavior (`not sub-issue` and missing `triaged`)
  - `needsGrooming` aligned to domain behavior (`triaged` and not `groomed`)
- Tests:
  - `tests/pev/example-machine.test.ts` now asserts triage and grooming action flows
  - `tests/pev/example-events-routing.test.ts` includes context-loader normalization coverage

### Sprint 3 (part 1): CI/review/merge queue behavior

- `machines/example/machine.ts`
  - `awaitingMerge` is now an executable queue state (not a placeholder final state).
  - `processingMerge` now enqueues merge actions and runs through the PEV runner.
- `machines/example/states.ts`
  - Added queue assigners for:
    - `assignAwaitingMergeQueue` (`appendHistory`)
    - `assignMergeQueue` (`updateStatus -> appendHistory`)
- Tests:
  - `tests/pev/example-machine.test.ts` now asserts:
    - approved review trigger executes awaiting-merge queue
    - `pr-merged` trigger executes merge queue and marks status `Done`

### Sprint 3 (part 2): failure-path review/CI loop context

- `machines/example/states.ts`
  - Iteration queue now adds explicit failure-context history entries when:
    - CI failed (`ciResult === "failure"`)
    - review requested changes (`reviewDecision === "CHANGES_REQUESTED"`)
  - Review queue now adds explicit comment-context history when:
    - review commented (`reviewDecision === "COMMENTED"`)
- Tests:
  - `tests/pev/example-machine.test.ts` asserts these context-specific history entries
    are emitted on the corresponding trigger/decision paths.

### Sprint 3 (part 3): deploy lifecycle queues

- `machines/example/machine.ts`
  - Deploy triggers now route to executable queue states instead of logging-only finals:
    - `processingDeployedStage`
    - `processingDeployedProd`
    - `processingDeployedStageFailure`
    - `processingDeployedProdFailure`
- `machines/example/states.ts`
  - Added queue assigners for deploy flows:
    - `assignDeployedStageQueue` (append deploy-success history)
    - `assignDeployedProdQueue` (ensure status `Done` + append deploy-success history)
    - `assignDeployedStageFailureQueue` (set status `Error` + append failure history)
    - `assignDeployedProdFailureQueue` (set status `Error` + append failure history)
- Tests:
  - `tests/pev/example-machine.test.ts` now asserts deploy stage/prod success and
    failure triggers execute their queues and mutate status/history as expected.

### Hardening pass: remove trigger placeholders

- `machines/example/machine.ts`
  - Former placeholder trigger states (`pivoting`, `resetting`, `retrying`,
    `commenting`, `prReviewing`, `prResponding`, `prRespondingHuman`, `prPush`,
    `orchestrating`, `mergeQueueLogging`, `mergeQueueFailureLogging`) are now
    executable queue states routed through the PEV runner.
- `machines/example/states.ts`
  - Added concrete queue builders/assigners for each of these trigger families
    so all mapped triggers execute explicit actions and produce deterministic
    domain side effects/history.
- Tests:
  - `tests/pev/example-state-matrix.test.ts` adds broad scenario coverage for
    these paths with assertions on action traces and final domain outcomes.

### Parity with issues machine

- `machines/example/guards.ts`
  - `needsSubIssues` — placeholder (returns false), routes to `initializing`
  - `triggeredByGroomSummary` — separate guard for `issue-groom-summary` (ARC 37)
  - Compound guards for ARC 25-27, 29-31: `triggeredByCIAndReadyForReview`, `triggeredByCIAndShouldBlock`, `triggeredByCIAndShouldContinue`, `triggeredByReviewAndApproved`, `triggeredByReviewAndChanges`, `triggeredByReviewAndCommented`
- `machines/example/machine.ts`
  - `initializing` — queue: runOrchestration + appendHistory (ARC 39)
  - `iteratingFix` — CI failure / review changes route here; queue uses mode `retry` (ARC 26, 30)
  - `alreadyBlocked` — no-op terminal when issue is already blocked (ARC 6)
  - `triggeredByPRReviewApproved` → `awaitingMerge` direct (ARC 23)
  - ARC 25-28: CI direct transitions (readyForReview, shouldBlock, shouldContinue, processingCI)
  - ARC 29-32: Review direct transitions (approved→awaitingMerge, changes→iteratingFix, commented→reviewing)
  - ARC 42: `readyForReview` → `transitioningToReview` standalone
  - `processingReview` removed (replaced by direct transitions)
- `machines/example/states.ts`
  - `buildIterateFixQueue` — same as iterate but mode `retry` for fix-CI path

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
