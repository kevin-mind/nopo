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

type Evt = { type: "START" } & EventObject;

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
    guards: {},
    domainStates: {
      routing: {
        on: { START: { target: "queueing" } },
      },
      queueing: {
        entry: assignQueue,
        always: RUNNER_STATES.executingQueue,
      },
    },
  });
}

function run(
  machine: ReturnType<typeof makeMachine>,
  ctx: Ctx,
  maxTransitions = 100,
) {
  const actor = createActor(machine, {
    input: {
      domain: ctx,
      maxTransitions,
      runnerCtx: { token: "t", owner: "o", repo: "r" },
    },
  });
  actor.start();
  actor.send({ type: "START" });
  return waitFor(actor, (s) => s.status === "done", { timeout: 5000 });
}

// ============================================================================
// Tests
// ============================================================================

describe("Runner States", () => {
  it("empty queue → done immediately", async () => {
    const machine = makeMachine(makeRegistry(), () => []);
    const snap = await run(machine, { counter: 0 });

    expect(String(snap.value)).toBe("done");
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

    expect(String(snap.value)).toBe("done");
    expect(executeFn).toHaveBeenCalledOnce();
    expect(snap.context.completedActions).toHaveLength(1);
    expect(snap.context.completedActions[0]?.verified).toBe(true);
    expect(snap.context.transitionCount).toBe(1);
  });

  it("multiple actions → sequential processing", async () => {
    const executionOrder: string[] = [];
    const registry = makeRegistry({
      step: {
        execute: async (action) => {
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

    expect(String(snap.value)).toBe("done");
    expect(executionOrder).toEqual(["A", "B", "C"]);
    expect(snap.context.completedActions).toHaveLength(3);
  });

  it("max transitions → early exit with remaining queue", async () => {
    const registry = makeRegistry();
    const machine = makeMachine(registry, () => [
      { type: "step", label: "1" },
      { type: "step", label: "2" },
      { type: "step", label: "3" },
      { type: "step", label: "4" },
      { type: "step", label: "5" },
    ]);

    const snap = await run(machine, { counter: 0 }, 3);

    expect(String(snap.value)).toBe("transitionLimitReached");
    expect(snap.context.completedActions).toHaveLength(3);
    expect(snap.context.actionQueue).toHaveLength(2);
    expect(snap.context.transitionCount).toBe(3);
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
  });

  it("failure mid-queue stops execution", async () => {
    const executionOrder: string[] = [];
    const registry = makeRegistry({
      step: {
        execute: async (action) => {
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

    expect(String(snap.value)).toBe("done");
    expect(refreshFn).toHaveBeenCalledOnce();
    expect(snap.context.domain.counter).toBe(10);
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
