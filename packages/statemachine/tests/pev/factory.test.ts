/**
 * Tests for createDomainMachine factory.
 *
 * Verifies the factory correctly composes domain states with the
 * shared PEV runner infrastructure.
 */

import { describe, it, expect } from "vitest";
import { createActor, waitFor, assign } from "xstate";
import type { EventObject } from "xstate";
import { createDomainMachine } from "../../src/core/pev/domain-machine.js";
import type { ActionRegistry } from "../../src/core/pev/types.js";

// ============================================================================
// Minimal Test Types
// ============================================================================

interface TestContext {
  value: number;
}

interface TestAction {
  type: string;
  payload?: string;
}

type TestEvent = EventObject;

// ============================================================================
// Helpers
// ============================================================================

function createTestRegistry(
  overrides?: Partial<ActionRegistry<TestAction, TestContext>>,
): ActionRegistry<TestAction, TestContext> {
  return {
    increment: {
      predict: () => ({
        description: "Increment the value",
        checks: [{ comparator: "eq", field: "value", expected: 1 }],
      }),
      execute: async () => ({ ok: true }),
      verify: () => ({ pass: true, message: "Value incremented" }),
    },
    fail: {
      predict: () => ({ description: "This will fail" }),
      execute: async () => {
        throw new Error("Execution error");
      },
    },
    verifyFail: {
      predict: () => ({ description: "Verify will fail" }),
      execute: async () => ({ ok: true }),
      verify: () => ({
        pass: false,
        message: "Verification failed",
        diffs: [{ field: "value", expected: 1, actual: 0 }],
      }),
    },
    ...overrides,
  };
}

function createMinimalMachine(
  registry: ActionRegistry<TestAction, TestContext>,
  domainStates?: Record<string, unknown>,
) {
  return createDomainMachine<TestContext, TestAction, TestEvent>({
    id: "test",
    actionRegistry: registry,
    refreshContext: async (_runnerCtx, current) => current,
    guards: {
      hasActions: ({ context }) =>
        context.domain.value > 0 && context.cycleCount === 0,
    },
    domainStates: domainStates ?? {
      routing: {
        always: [
          { target: "building", guard: "hasActions" },
          { target: "idle" },
        ],
      },
      building: {
        entry: assign({
          actionQueue: (): TestAction[] => [
            { type: "increment", payload: "first" },
          ],
        }),
        always: "executingQueue",
      },
      idle: { type: "final" },
    },
  });
}

function runMachine(
  machine: ReturnType<typeof createMinimalMachine>,
  domain: TestContext,
  maxCycles = 10,
) {
  const actor = createActor(machine, {
    input: {
      domain,
      maxCycles,
      runnerCtx: { token: "test", owner: "test", repo: "test" },
    },
  });

  actor.start();

  return waitFor(actor, (s) => s.status === "done", { timeout: 5000 });
}

// ============================================================================
// Tests
// ============================================================================

describe("createDomainMachine", () => {
  it("creates a machine with domain and runner states", async () => {
    const registry = createTestRegistry();
    const machine = createMinimalMachine(registry);
    const snapshot = await runMachine(machine, { value: 1 });

    expect(snapshot.status).toBe("done");
    expect(String(snapshot.value)).toBe("idle");
    expect(snapshot.context.completedActions).toHaveLength(1);
    expect(snapshot.context.completedActions[0]?.action.type).toBe("increment");
    expect(snapshot.context.completedActions[0]?.verified).toBe(true);
  });

  it("routes to idle when guard fails", async () => {
    const registry = createTestRegistry();
    const machine = createMinimalMachine(registry);
    const snapshot = await runMachine(machine, { value: 0 });

    expect(String(snapshot.value)).toBe("idle");
    expect(snapshot.context.completedActions).toHaveLength(0);
  });

  it("respects maxCycles limit", async () => {
    const registry = createTestRegistry();
    const machine = createDomainMachine<TestContext, TestAction, TestEvent>({
      id: "test-limit",
      actionRegistry: registry,
      refreshContext: async (_runnerCtx, current) => current,
      guards: {},
      domainStates: {
        routing: {
          always: { target: "building" },
        },
        building: {
          entry: assign({
            actionQueue: (): TestAction[] => [
              { type: "increment", payload: "1" },
              { type: "increment", payload: "2" },
              { type: "increment", payload: "3" },
            ],
          }),
          always: "executingQueue",
        },
      },
    });

    const snapshot = await runMachine(machine, { value: 1 }, 2);

    expect(String(snapshot.value)).toBe("done");
    // 2 cycles × 3 actions per queue = 6 completed
    expect(snapshot.context.completedActions).toHaveLength(6);
    expect(snapshot.context.cycleCount).toBe(2);
    // Queue is fully drained each cycle
    expect(snapshot.context.actionQueue).toHaveLength(0);
  });

  it("drains the full queue when limit is high enough", async () => {
    const registry = createTestRegistry();
    const machine = createDomainMachine<TestContext, TestAction, TestEvent>({
      id: "test-drain",
      actionRegistry: registry,
      refreshContext: async (_runnerCtx, current) => current,
      guards: {
        firstCycle: ({ context }) => context.cycleCount === 0,
      },
      domainStates: {
        routing: {
          always: [
            { target: "building", guard: "firstCycle" },
            { target: "idle" },
          ],
        },
        building: {
          entry: assign({
            actionQueue: (): TestAction[] => [
              { type: "increment", payload: "1" },
              { type: "increment", payload: "2" },
              { type: "increment", payload: "3" },
            ],
          }),
          always: "executingQueue",
        },
        idle: { type: "final" },
      },
    });

    const snapshot = await runMachine(machine, { value: 1 }, 10);

    expect(String(snapshot.value)).toBe("idle");
    expect(snapshot.context.completedActions).toHaveLength(3);
    expect(snapshot.context.actionQueue).toHaveLength(0);
  });

  it("handles execution failures", async () => {
    const registry = createTestRegistry();
    const machine = createDomainMachine<TestContext, TestAction, TestEvent>({
      id: "test-fail",
      actionRegistry: registry,
      refreshContext: async (_runnerCtx, current) => current,
      guards: {},
      domainStates: {
        routing: {
          always: { target: "building" },
        },
        building: {
          entry: assign({
            actionQueue: (): TestAction[] => [{ type: "fail" }],
          }),
          always: "executingQueue",
        },
      },
    });

    const snapshot = await runMachine(machine, { value: 1 });

    expect(String(snapshot.value)).toBe("executionFailed");
    expect(snapshot.context.error).toBe("Execution error");
    expect(snapshot.context.completedActions).toHaveLength(0);
  });

  it("handles verification failures", async () => {
    const registry = createTestRegistry();
    const machine = createDomainMachine<TestContext, TestAction, TestEvent>({
      id: "test-verify-fail",
      actionRegistry: registry,
      refreshContext: async (_runnerCtx, current) => current,
      guards: {},
      domainStates: {
        routing: {
          always: { target: "building" },
        },
        building: {
          entry: assign({
            actionQueue: (): TestAction[] => [{ type: "verifyFail" }],
          }),
          always: "executingQueue",
        },
      },
    });

    const snapshot = await runMachine(machine, { value: 1 });

    expect(String(snapshot.value)).toBe("verificationFailed");
    expect(snapshot.context.error).toContain("Verification failed");
    expect(snapshot.context.verifyResult?.pass).toBe(false);
  });

  it("auto-passes when action has no verify defined", async () => {
    const registry: ActionRegistry<TestAction, TestContext> = {
      noVerify: {
        execute: async () => ({ ok: true }),
        // No predict or verify defined
      },
    };

    const machine = createDomainMachine<TestContext, TestAction, TestEvent>({
      id: "test-no-verify",
      actionRegistry: registry,
      refreshContext: async (_runnerCtx, current) => current,
      guards: {
        firstCycle: ({ context }) => context.cycleCount === 0,
      },
      domainStates: {
        routing: {
          always: [
            { target: "building", guard: "firstCycle" },
            { target: "idle" },
          ],
        },
        building: {
          entry: assign({
            actionQueue: (): TestAction[] => [{ type: "noVerify" }],
          }),
          always: "executingQueue",
        },
        idle: { type: "final" },
      },
    });

    const snapshot = await runMachine(machine, { value: 1 });

    expect(String(snapshot.value)).toBe("idle");
    expect(snapshot.context.completedActions).toHaveLength(1);
    expect(snapshot.context.completedActions[0]?.verified).toBe(true);
  });

  it("stores predictions from predict phase", async () => {
    let capturedPrediction: unknown = null;
    const registry: ActionRegistry<TestAction, TestContext> = {
      predictable: {
        predict: () => ({
          description: "Will double the value",
          checks: [{ comparator: "eq", field: "value", expected: 1 }],
        }),
        execute: async (_action, _ctx) => {
          return { doubled: true };
        },
        verify: () => ({ pass: true, message: "ok" }),
      },
    };

    const machine = createDomainMachine<TestContext, TestAction, TestEvent>({
      id: "test-predict",
      actionRegistry: registry,
      refreshContext: async (_runnerCtx, current) => current,
      guards: {
        firstCycle: ({ context }) => context.cycleCount === 0,
      },
      domainStates: {
        routing: {
          always: [
            { target: "building", guard: "firstCycle" },
            { target: "idle" },
          ],
        },
        building: {
          entry: assign({
            actionQueue: (): TestAction[] => [{ type: "predictable" }],
          }),
          always: "executingQueue",
        },
        idle: { type: "final" },
      },
    });

    const actor = createActor(machine, {
      input: {
        domain: { value: 1 },
        maxCycles: 10,
        runnerCtx: { token: "test", owner: "test", repo: "test" },
      },
    });

    // Capture intermediate state to check prediction
    actor.subscribe((s) => {
      if (s.context.prediction) {
        capturedPrediction = s.context.prediction;
      }
    });

    actor.start();

    await waitFor(actor, (s) => s.status === "done", { timeout: 5000 });

    expect(capturedPrediction).toEqual({
      description: "Will double the value",
      checks: [{ comparator: "eq", field: "value", expected: 1 }],
    });
  });

  it("passes domain context to execute", async () => {
    let capturedDomain: TestContext | null = null;

    const registry: ActionRegistry<TestAction, TestContext> = {
      captureCtx: {
        execute: async (_action, domain) => {
          capturedDomain = domain;
          return { ok: true };
        },
      },
    };

    const machine = createDomainMachine<TestContext, TestAction, TestEvent>({
      id: "test-domain-ctx",
      actionRegistry: registry,
      refreshContext: async (_runnerCtx, current) => current,
      guards: {
        firstCycle: ({ context }) => context.cycleCount === 0,
      },
      domainStates: {
        routing: {
          always: [
            { target: "building", guard: "firstCycle" },
            { target: "idle" },
          ],
        },
        building: {
          entry: assign({
            actionQueue: (): TestAction[] => [{ type: "captureCtx" }],
          }),
          always: "executingQueue",
        },
        idle: { type: "final" },
      },
    });

    const snapshot = await runMachine(machine, { value: 1 });
    expect(String(snapshot.value)).toBe("idle");
    expect(capturedDomain).toEqual({ value: 1 });
  });

  it("updates domain context via refreshContext after verification", async () => {
    let refreshCallCount = 0;

    const registry: ActionRegistry<TestAction, TestContext> = {
      inc: {
        execute: async () => ({ ok: true }),
        verify: () => ({ pass: true, message: "ok" }),
      },
    };

    const machine = createDomainMachine<TestContext, TestAction, TestEvent>({
      id: "test-refresh",
      actionRegistry: registry,
      refreshContext: async (_runnerCtx, current) => {
        refreshCallCount++;
        return { value: current.value + 1 };
      },
      guards: {
        firstCycle: ({ context }) => context.cycleCount === 0,
      },
      domainStates: {
        routing: {
          always: [
            { target: "building", guard: "firstCycle" },
            { target: "idle" },
          ],
        },
        building: {
          entry: assign({
            actionQueue: (): TestAction[] => [{ type: "inc" }, { type: "inc" }],
          }),
          always: "executingQueue",
        },
        idle: { type: "final" },
      },
    });

    const snapshot = await runMachine(machine, { value: 0 });

    expect(String(snapshot.value)).toBe("idle");
    expect(refreshCallCount).toBe(2);
    // Domain context should have been updated by refreshContext
    expect(snapshot.context.domain.value).toBe(2);
  });

  it("transitions to idle with empty queue after one cycle", async () => {
    const machine = createDomainMachine<TestContext, TestAction, TestEvent>({
      id: "test-empty",
      actionRegistry: {},
      refreshContext: async (_runnerCtx, current) => current,
      guards: {
        firstCycle: ({ context }) => context.cycleCount === 0,
      },
      domainStates: {
        routing: {
          always: [
            { target: "building", guard: "firstCycle" },
            { target: "idle" },
          ],
        },
        building: {
          // No actions queued
          always: "executingQueue",
        },
        idle: { type: "final" },
      },
    });

    const snapshot = await runMachine(machine, { value: 0 });

    expect(String(snapshot.value)).toBe("idle");
    expect(snapshot.context.completedActions).toHaveLength(0);
  });
});
