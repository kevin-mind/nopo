/**
 * Tests for shared runner states.
 *
 * These test the predict → execute → verify cycle mechanics:
 * queue management, sequential processing, limits, and error handling.
 */

import { describe, it, expect, vi } from "vitest";
import { createActor, waitFor, assign } from "xstate";
import type { AnyEventObject, EventObject } from "xstate";
import { createDomainMachine } from "../../src/core/pev/domain-machine.js";
import type {
  ActionRegistry,
  RunnerMachineContext,
} from "../../src/core/pev/types.js";
import { RUNNER_STATES } from "../../src/core/pev/runner-states.js";

// ============================================================================
// Test Types
// ============================================================================

interface Ctx {
  counter: number;
}

interface Act {
  type: string;
  label?: string;
}

type Evt = EventObject;

// ============================================================================
// Helpers
// ============================================================================

function makeRegistry(
  overrides?: Partial<ActionRegistry<Act, Ctx>>,
): ActionRegistry<Act, Ctx> {
  return {
    step: {
      predict: (action) => ({
        description: `Step: ${action.label ?? "unnamed"}`,
      }),
      execute: async () => ({ done: true }),
      verify: () => ({ pass: true, message: "Step verified" }),
    },
    ...overrides,
  };
}

type FullCtx = RunnerMachineContext<Ctx, Act>;

function makeMachine(
  registry: ActionRegistry<Act, Ctx>,
  queueBuilder: (context: FullCtx) => Act[],
  refreshFn?: (ctx: Ctx) => Promise<Ctx>,
) {
  const assignQueue = assign<
    FullCtx,
    AnyEventObject,
    undefined,
    EventObject,
    never
  >({
    actionQueue: ({ context }) => queueBuilder(context),
  });

  return createDomainMachine<Ctx, Act, Evt>({
    id: "runner-test",
    actionRegistry: registry,
    refreshContext: refreshFn
      ? async (_rc, current) => refreshFn(current)
      : async (_rc, current) => current,
    guards: {
      firstCycle: ({ context }) => context.cycleCount === 0,
    },
    domainStates: {
      routing: {
        always: [
          { target: "queueing", guard: "firstCycle" },
          { target: "idle" },
        ],
      },
      queueing: {
        entry: assignQueue,
        always: RUNNER_STATES.executingQueue,
      },
      idle: { type: "final" },
    },
  });
}

function run(
  machine: ReturnType<typeof makeMachine>,
  ctx: Ctx,
  maxCycles = 100,
) {
  const actor = createActor(machine, {
    input: {
      domain: ctx,
      maxCycles,
      runnerCtx: { token: "t", owner: "o", repo: "r" },
      services: null,
    },
  });
  actor.start();
  return waitFor(actor, (s) => s.status === "done", { timeout: 5000 });
}

// ============================================================================
// Tests
// ============================================================================

describe("Runner States", () => {
  it("empty queue → done immediately", async () => {
    const machine = makeMachine(makeRegistry(), () => []);
    const snap = await run(machine, { counter: 0 });

    expect(String(snap.value)).toBe("idle");
    expect(snap.context.completedActions).toHaveLength(0);
  });

  it("single action → predict → execute → verify → done", async () => {
    const executeFn = vi.fn().mockResolvedValue({ ok: true });
    const registry = makeRegistry({
      step: {
        predict: () => ({ description: "Single step" }),
        execute: executeFn,
        verify: () => ({ pass: true, message: "ok" }),
      },
    });

    const machine = makeMachine(registry, () => [
      { type: "step", label: "only" },
    ]);
    const snap = await run(machine, { counter: 0 });

    expect(String(snap.value)).toBe("idle");
    expect(executeFn).toHaveBeenCalledOnce();
    expect(snap.context.completedActions).toHaveLength(1);
    expect(snap.context.completedActions[0]?.verified).toBe(true);
    expect(snap.context.cycleCount).toBe(1);
  });

  it("multiple actions → sequential processing", async () => {
    const executionOrder: string[] = [];
    const registry = makeRegistry({
      step: {
        execute: async ({ action }) => {
          executionOrder.push(action.label ?? "?");
          return { ok: true };
        },
        verify: () => ({ pass: true, message: "ok" }),
      },
    });

    const machine = makeMachine(registry, () => [
      { type: "step", label: "A" },
      { type: "step", label: "B" },
      { type: "step", label: "C" },
    ]);

    const snap = await run(machine, { counter: 0 });

    expect(String(snap.value)).toBe("idle");
    expect(executionOrder).toEqual(["A", "B", "C"]);
    expect(snap.context.completedActions).toHaveLength(3);
  });

  it("max cycles → stops after N complete queue runs", async () => {
    const registry = makeRegistry();
    const assignQueue = assign<
      FullCtx,
      AnyEventObject,
      undefined,
      EventObject,
      never
    >({
      actionQueue: () => [
        { type: "step", label: "a" },
        { type: "step", label: "b" },
      ],
    });
    const machine = createDomainMachine<Ctx, Act, Evt>({
      id: "runner-cycles-test",
      actionRegistry: registry,
      refreshContext: async (_rc, current) => current,
      guards: {},
      domainStates: {
        routing: {
          always: "queueing",
        },
        queueing: {
          entry: assignQueue,
          always: RUNNER_STATES.executingQueue,
        },
      },
    });

    const snap = await run(machine, { counter: 0 }, 3);

    expect(String(snap.value)).toBe("done");
    // 3 cycles × 2 actions per queue = 6 completed
    expect(snap.context.completedActions).toHaveLength(6);
    expect(snap.context.cycleCount).toBe(3);
  });

  it("afterQueue receives only the current queue's completedActions", async () => {
    const registry = makeRegistry();
    const afterQueueCalls: Array<{ label: string | null; count: number }> = [];
    const assignQueue = assign<
      FullCtx,
      AnyEventObject,
      undefined,
      EventObject,
      never
    >({
      actionQueue: ({ context }) => [
        { type: "step", label: `cycle-${context.cycleCount}` },
      ],
    });
    const machine = createDomainMachine<Ctx, Act, Evt>({
      id: "afterqueue-test",
      actionRegistry: registry,
      refreshContext: async (_rc, current) => current,
      guards: {},
      afterQueue: (_rc, _domain, queueLabel, completedActions) => {
        afterQueueCalls.push({
          label: queueLabel,
          count: completedActions.length,
        });
      },
      domainStates: {
        routing: {
          always: "queueing",
        },
        queueing: {
          entry: assignQueue,
          always: RUNNER_STATES.executingQueue,
        },
      },
    });

    const snap = await run(machine, { counter: 0 }, 3);

    expect(String(snap.value)).toBe("done");
    expect(snap.context.completedActions).toHaveLength(3);
    // Each afterQueue call should receive exactly 1 action (from its own queue)
    expect(afterQueueCalls).toHaveLength(3);
    expect(afterQueueCalls[0]?.count).toBe(1);
    expect(afterQueueCalls[1]?.count).toBe(1);
    expect(afterQueueCalls[2]?.count).toBe(1);
  });

  it("afterQueue receives empty slice when queue is empty after a non-empty queue", async () => {
    const registry = makeRegistry();
    const afterQueueCalls: Array<{ count: number }> = [];
    const assignQueue = assign<
      FullCtx,
      AnyEventObject,
      undefined,
      EventObject,
      never
    >({
      // First cycle: 2 actions, second cycle: empty queue
      actionQueue: ({ context }) =>
        context.cycleCount === 0
          ? [
              { type: "step", label: "a" },
              { type: "step", label: "b" },
            ]
          : [],
    });
    const machine = createDomainMachine<Ctx, Act, Evt>({
      id: "afterqueue-empty-test",
      actionRegistry: registry,
      refreshContext: async (_rc, current) => current,
      guards: {},
      afterQueue: (_rc, _domain, _ql, completedActions) => {
        afterQueueCalls.push({ count: completedActions.length });
      },
      domainStates: {
        routing: {
          always: "queueing",
        },
        queueing: {
          entry: assignQueue,
          always: RUNNER_STATES.executingQueue,
        },
      },
    });

    const snap = await run(machine, { counter: 0 }, 2);

    expect(String(snap.value)).toBe("done");
    expect(snap.context.completedActions).toHaveLength(2);
    expect(afterQueueCalls).toHaveLength(2);
    // First afterQueue: 2 actions from cycle 1
    expect(afterQueueCalls[0]?.count).toBe(2);
    // Second afterQueue: 0 actions (empty queue, NOT stale cycle 1 results)
    expect(afterQueueCalls[1]?.count).toBe(0);
  });

  it("execution failure → executionFailed state", async () => {
    const registry = makeRegistry({
      step: {
        execute: async () => {
          throw new Error("Boom");
        },
      },
    });

    const machine = makeMachine(registry, () => [{ type: "step" }]);
    const snap = await run(machine, { counter: 0 });

    expect(String(snap.value)).toBe("executionFailed");
    expect(snap.context.error).toBe("Boom");
  });

  it("verification failure → verificationFailed state", async () => {
    const registry = makeRegistry({
      step: {
        execute: async () => ({ ok: true }),
        verify: () => ({
          pass: false,
          message: "Expected counter=1 but got counter=0",
          diffs: [{ field: "counter", expected: 1, actual: 0 }],
        }),
      },
    });

    const machine = makeMachine(registry, () => [{ type: "step" }]);
    const snap = await run(machine, { counter: 0 });

    expect(String(snap.value)).toBe("verificationFailed");
    expect(snap.context.verifyResult?.pass).toBe(false);
    expect(snap.context.verifyResult?.diffs).toHaveLength(1);
    expect(snap.context.error).toContain("Verification failed");
  });

  it("failure mid-queue stops execution", async () => {
    const executionOrder: string[] = [];
    const registry = makeRegistry({
      step: {
        execute: async ({ action }) => {
          const label = action.label ?? "?";
          executionOrder.push(label);
          if (label === "B") throw new Error("B failed");
          return { ok: true };
        },
        verify: () => ({ pass: true, message: "ok" }),
      },
    });

    const machine = makeMachine(registry, () => [
      { type: "step", label: "A" },
      { type: "step", label: "B" },
      { type: "step", label: "C" },
    ]);

    const snap = await run(machine, { counter: 0 });

    expect(String(snap.value)).toBe("executionFailed");
    expect(executionOrder).toEqual(["A", "B"]);
    expect(snap.context.completedActions).toHaveLength(1);
    // Partial results from BatchExecuteError are marked as unverified
    expect(snap.context.completedActions[0]?.action.label).toBe("A");
    expect(snap.context.completedActions[0]?.verified).toBe(false);
    expect(snap.context.error).toBe("B failed");
  });

  it("batch verify with mixed pass/fail reports first failure", async () => {
    const registry: ActionRegistry<Act, Ctx> = {
      pass: {
        predict: () => ({
          description: "This passes",
          checks: [{ comparator: "eq", field: "counter", expected: 0 }],
        }),
        execute: async () => ({ ok: true }),
      },
      fail: {
        predict: () => ({
          description: "This fails",
          checks: [{ comparator: "eq", field: "counter", expected: 999 }],
        }),
        execute: async () => ({ ok: true }),
      },
    };

    const machine = makeMachine(registry, () => [
      { type: "pass", label: "A" },
      { type: "fail", label: "B" },
    ]);
    const snap = await run(machine, { counter: 0 });

    expect(String(snap.value)).toBe("verificationFailed");
    // Both actions are in completedActions
    expect(snap.context.completedActions).toHaveLength(2);
    // First action passed verification
    expect(snap.context.completedActions[0]?.verified).toBe(true);
    // Second action failed verification
    expect(snap.context.completedActions[1]?.verified).toBe(false);
    // verifyResult captures the first failure
    expect(snap.context.verifyResult?.pass).toBe(false);
  });

  it("refreshContext is called during verify phase", async () => {
    const refreshFn = vi.fn().mockImplementation(async (current: Ctx) => ({
      counter: current.counter + 10,
    }));

    const registry = makeRegistry({
      step: {
        execute: async () => ({ ok: true }),
        verify: () => ({ pass: true, message: "ok" }),
      },
    });

    const machine = makeMachine(registry, () => [{ type: "step" }], refreshFn);
    const snap = await run(machine, { counter: 0 });

    expect(String(snap.value)).toBe("idle");
    expect(refreshFn).toHaveBeenCalledOnce();
    expect(snap.context.domain.counter).toBe(10);
  });

  it("refreshContext is called once per queue regardless of action count", async () => {
    let refreshCount = 0;
    const registry = makeRegistry({
      step: {
        execute: async () => ({ ok: true }),
        verify: () => ({ pass: true, message: "ok" }),
      },
    });

    const machine = makeMachine(
      registry,
      () => [
        { type: "step", label: "A" },
        { type: "step", label: "B" },
        { type: "step", label: "C" },
      ],
      async (current) => {
        refreshCount++;
        return current;
      },
    );
    const snap = await run(machine, { counter: 0 });

    expect(String(snap.value)).toBe("idle");
    expect(snap.context.completedActions).toHaveLength(3);
    // Batch PEV: single refresh per queue, not per action
    expect(refreshCount).toBe(1);
  });

  it("preActionSnapshot captures state before execution", async () => {
    let snapshotValue: number | null = null;
    const registry = makeRegistry({
      step: {
        execute: async () => ({ ok: true }),
        verify: ({ oldCtx }) => {
          snapshotValue = oldCtx.counter;
          return { pass: true, message: "ok" };
        },
      },
    });

    const machine = makeMachine(registry, () => [{ type: "step" }]);
    await run(machine, { counter: 42 });

    expect(snapshotValue).toBe(42);
  });
});
