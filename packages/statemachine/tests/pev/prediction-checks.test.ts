import { describe, it, expect } from "vitest";
import { assign, createActor, waitFor } from "xstate";
import { createDomainMachine } from "../../src/core/pev/domain-machine.js";
import { evaluatePredictionChecks } from "../../src/core/pev/prediction-checks.js";
import type {
  ActionRegistry,
  PredictionCheck,
  VerifyArgs,
} from "../../src/core/pev/types.js";

function isOkResult(value: unknown): value is { ok: true } {
  if (value == null || typeof value !== "object") return false;
  return Reflect.get(value, "ok") === true;
}

interface DemoCtx {
  issue: {
    number: number;
    labels: string[];
    failures: number;
    title: string;
    nested?: { value: number };
  };
  counter: number;
}

interface DemoAction {
  type: string;
}

function runMachine(registry: ActionRegistry<DemoAction, DemoCtx>) {
  const machine = createDomainMachine<DemoCtx, DemoAction>({
    id: "prediction-checks-test",
    actionRegistry: registry,
    refreshContext: async (_runnerCtx, current) => current,
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
        entry: assign({
          actionQueue: () => [{ type: "step" }],
        }),
        always: "executingQueue",
      },
      idle: { type: "final" },
    },
  });

  const actor = createActor(machine, {
    input: {
      domain: {
        issue: {
          number: 42,
          labels: [],
          failures: 2,
          title: "Test Issue",
          nested: { value: 10 },
        },
        counter: 1,
      },
      runnerCtx: {
        token: "t",
        owner: "o",
        repo: "r",
      },
      maxCycles: 10,
      services: null,
    },
  });

  actor.start();
  return waitFor(actor, (s) => s.status === "done", { timeout: 5000 });
}

describe("evaluatePredictionChecks", () => {
  const oldCtx: DemoCtx = {
    issue: {
      number: 42,
      labels: ["triaged"],
      failures: 2,
      title: "Old title",
      nested: { value: 5 },
    },
    counter: 1,
  };

  const newCtx: DemoCtx = {
    issue: {
      number: 42,
      labels: ["triaged", "groomed"],
      failures: 0,
      title: "Updated title",
      nested: { value: 12 },
    },
    counter: 3,
  };

  it("passes for eq checks", () => {
    const checks: PredictionCheck[] = [
      { comparator: "eq", field: "issue.number", expected: 42 },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(true);
  });

  it("fails for eq checks", () => {
    const checks: PredictionCheck[] = [
      { comparator: "eq", field: "issue.number", expected: 99 },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(false);
    expect(result.diffs).toHaveLength(1);
  });

  it("supports gte and lte checks", () => {
    const checks: PredictionCheck[] = [
      { comparator: "gte", field: "counter", expected: 2 },
      { comparator: "lte", field: "counter", expected: 5 },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(true);
  });

  it("supports subset checks", () => {
    const checks: PredictionCheck[] = [
      { comparator: "subset", field: "issue.labels", expected: ["triaged"] },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(true);
  });

  it("supports includes checks for arrays and strings", () => {
    const checks: PredictionCheck[] = [
      { comparator: "includes", field: "issue.labels", expected: "groomed" },
      { comparator: "includes", field: "issue.title", expected: "Updated" },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(true);
  });

  it("supports exists and startsWith checks", () => {
    const checks: PredictionCheck[] = [
      { comparator: "exists", field: "issue.nested.value" },
      { comparator: "startsWith", field: "issue.title", expected: "Updated" },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(true);
  });

  it("supports `from: old` source selection", () => {
    const checks: PredictionCheck[] = [
      {
        comparator: "eq",
        field: "issue.title",
        expected: "Old title",
        from: "old",
      },
      {
        comparator: "eq",
        field: "issue.title",
        expected: "Updated title",
        from: "new",
      },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(true);
  });

  it("supports grouped `all` checks", () => {
    const checks: PredictionCheck[] = [
      {
        comparator: "all",
        checks: [
          {
            comparator: "includes",
            field: "issue.labels",
            expected: "triaged",
          },
          {
            comparator: "includes",
            field: "issue.labels",
            expected: "groomed",
          },
        ],
      },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(true);
  });

  it("supports grouped `any` checks", () => {
    const checks: PredictionCheck[] = [
      {
        comparator: "any",
        checks: [
          { comparator: "eq", field: "issue.failures", expected: 2 },
          { comparator: "eq", field: "issue.failures", expected: 0 },
        ],
      },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(true);
  });

  it("fails `all` when one child fails", () => {
    const checks: PredictionCheck[] = [
      {
        comparator: "all",
        checks: [
          { comparator: "eq", field: "issue.number", expected: 42 },
          { comparator: "eq", field: "issue.number", expected: 99 },
        ],
      },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(false);
  });

  it("fails `any` when all children fail", () => {
    const checks: PredictionCheck[] = [
      {
        comparator: "any",
        checks: [
          { comparator: "eq", field: "issue.number", expected: 1 },
          { comparator: "eq", field: "issue.number", expected: 2 },
        ],
      },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(false);
  });

  it("startsWith fails when string does not start with expected prefix", () => {
    const checks: PredictionCheck[] = [
      { comparator: "startsWith", field: "issue.title", expected: "Old" },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(false);
    expect(result.diffs).toHaveLength(1);
  });

  it("startsWith fails when actual value is not a string", () => {
    const checks: PredictionCheck[] = [
      { comparator: "startsWith", field: "issue.number", expected: "4" },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(false);
    expect(result.diffs).toHaveLength(1);
  });

  it("startsWith passes using from:'old' reading pre-action context", () => {
    const checks: PredictionCheck[] = [
      {
        comparator: "startsWith",
        field: "issue.title",
        expected: "Old",
        from: "old",
      },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(true);
  });

  it("from:'old' fails when old context value does not match expected", () => {
    const checks: PredictionCheck[] = [
      {
        comparator: "startsWith",
        field: "issue.title",
        expected: "Updated",
        from: "old",
      },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(false);
    expect(result.diffs).toHaveLength(1);
  });

  it("deeply nested path (3+ levels) resolves correctly for eq comparator", () => {
    const checks: PredictionCheck[] = [
      { comparator: "eq", field: "issue.nested.value", expected: 12 },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(true);
  });

  it("resolvePath returns undefined when an intermediate segment is missing", () => {
    const sparseCtx: DemoCtx = {
      issue: {
        number: 1,
        labels: [],
        failures: 0,
        title: "Sparse",
      },
      counter: 0,
    };
    const checks: PredictionCheck[] = [
      { comparator: "exists", field: "issue.nested.value" },
    ];
    const result = evaluatePredictionChecks(checks, sparseCtx, sparseCtx);
    expect(result.pass).toBe(false);
    expect(result.diffs).toHaveLength(1);
  });

  it("any with mixed children (one pass, one fail) returns pass:true with empty diffs", () => {
    const checks: PredictionCheck[] = [
      {
        comparator: "any",
        checks: [
          { comparator: "eq", field: "issue.number", expected: 42 },
          { comparator: "eq", field: "issue.number", expected: 99 },
        ],
      },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(true);
    expect(result.diffs).toHaveLength(0);
  });

  it("all collects diffs from all failing children (not just the first)", () => {
    const checks: PredictionCheck[] = [
      {
        comparator: "all",
        checks: [
          { comparator: "eq", field: "issue.number", expected: 1 },
          { comparator: "eq", field: "issue.failures", expected: 999 },
        ],
      },
    ];
    const result = evaluatePredictionChecks(checks, oldCtx, newCtx);
    expect(result.pass).toBe(false);
    expect(result.diffs).toHaveLength(2);
  });
});

describe("runner integration with prediction checks", () => {
  it("auto-fails verification when prediction checks fail and no verify is defined", async () => {
    const registry: ActionRegistry<DemoAction, DemoCtx> = {
      step: {
        predict: () => ({
          description: "Require triaged label",
          checks: [
            {
              comparator: "includes",
              field: "issue.labels",
              expected: "triaged",
            },
          ],
        }),
        execute: async ({ ctx }) => {
          ctx.issue.labels = [];
          return { ok: true };
        },
      },
    };

    const snapshot = await runMachine(registry);
    expect(String(snapshot.value)).toBe("verificationFailed");
    expect(snapshot.context.verifyResult?.pass).toBe(false);
    expect(snapshot.context.verifyResult?.message).toContain(
      "Prediction checks failed",
    );
  });

  it("passes when prediction checks pass without custom verify", async () => {
    const registry: ActionRegistry<DemoAction, DemoCtx> = {
      step: {
        predict: () => ({
          description: "Require triaged label",
          checks: [
            {
              comparator: "includes",
              field: "issue.labels",
              expected: "triaged",
            },
          ],
        }),
        execute: async ({ ctx }) => {
          if (!ctx.issue.labels.includes("triaged"))
            ctx.issue.labels.push("triaged");
          return { ok: true };
        },
      },
    };

    const snapshot = await runMachine(registry);
    expect(String(snapshot.value)).toBe("idle");
    expect(snapshot.context.verifyResult?.pass).toBe(true);
  });

  it("enforces prediction checks even if custom verify returns pass", async () => {
    const registry: ActionRegistry<DemoAction, DemoCtx> = {
      step: {
        predict: () => ({
          description: "Require groomed label",
          checks: [
            {
              comparator: "includes",
              field: "issue.labels",
              expected: "groomed",
            },
          ],
        }),
        execute: async () => ({ ok: true }),
        verify: () => ({ pass: true, message: "Custom verify passed" }),
      },
    };

    const snapshot = await runMachine(registry);
    expect(String(snapshot.value)).toBe("verificationFailed");
    expect(snapshot.context.verifyResult?.pass).toBe(false);
    expect(snapshot.context.verifyResult?.message).toContain(
      "Prediction checks failed",
    );
  });

  it("passes modern verify args with predictionEval and executeResult", async () => {
    let sawPredictionPass = false;
    let sawExecuteOk = false;

    const registry: ActionRegistry<DemoAction, DemoCtx> = {
      step: {
        predict: () => ({
          description: "Require triaged label",
          checks: [
            {
              comparator: "includes",
              field: "issue.labels",
              expected: "triaged",
            },
          ],
        }),
        execute: async ({ ctx }) => {
          if (!ctx.issue.labels.includes("triaged"))
            ctx.issue.labels.push("triaged");
          return { ok: true };
        },
        verify: ({
          predictionEval,
          executeResult,
        }: VerifyArgs<DemoAction, DemoCtx>) => {
          sawPredictionPass = predictionEval.pass;
          sawExecuteOk = isOkResult(executeResult);
          return { pass: true, message: "modern verify" };
        },
      },
    };

    const snapshot = await runMachine(registry);
    expect(String(snapshot.value)).toBe("idle");
    expect(sawPredictionPass).toBe(true);
    expect(sawExecuteOk).toBe(true);
  });

  it("lets verify return void for pass", async () => {
    const registry: ActionRegistry<DemoAction, DemoCtx> = {
      step: {
        predict: () => ({
          description: "Require triaged label",
          checks: [
            {
              comparator: "includes",
              field: "issue.labels",
              expected: "triaged",
            },
          ],
        }),
        execute: async ({ ctx }) => {
          if (!ctx.issue.labels.includes("triaged"))
            ctx.issue.labels.push("triaged");
          return { ok: true };
        },
        verify: () => undefined,
      },
    };

    const snapshot = await runMachine(registry);
    expect(String(snapshot.value)).toBe("idle");
    expect(snapshot.context.verifyResult?.pass).toBe(true);
  });

  it("treats failure-only verify return object as failed verification", async () => {
    const registry: ActionRegistry<DemoAction, DemoCtx> = {
      step: {
        predict: () => ({
          description: "Require triaged label",
          checks: [
            {
              comparator: "includes",
              field: "issue.labels",
              expected: "triaged",
            },
          ],
        }),
        execute: async ({ ctx }) => {
          if (!ctx.issue.labels.includes("triaged"))
            ctx.issue.labels.push("triaged");
          return { ok: true };
        },
        verify: () => ({
          message: "Custom failure context",
          diffs: [
            {
              field: "issue.labels",
              expected: "triaged",
              actual: [],
            },
          ],
        }),
      },
    };

    const snapshot = await runMachine(registry);
    expect(String(snapshot.value)).toBe("verificationFailed");
    expect(snapshot.context.verifyResult?.pass).toBe(false);
    expect(snapshot.context.verifyResult?.message).toContain(
      "Custom failure context",
    );
  });

  it("includes check description in prediction diffs", () => {
    const baselineOldCtx: DemoCtx = {
      issue: {
        number: 42,
        labels: ["triaged"],
        failures: 1,
        title: "Old title",
        nested: { value: 5 },
      },
      counter: 1,
    };
    const baselineNewCtx: DemoCtx = {
      issue: {
        number: 42,
        labels: ["groomed"],
        failures: 0,
        title: "Updated title",
        nested: { value: 12 },
      },
      counter: 3,
    };
    const checks: PredictionCheck[] = [
      {
        comparator: "includes",
        description: 'Issue labels should include "triaged"',
        field: "issue.labels",
        expected: "triaged",
      },
    ];
    const result = evaluatePredictionChecks(
      checks,
      baselineOldCtx,
      baselineNewCtx,
    );
    expect(result.pass).toBe(false);
    expect(result.diffs[0]?.description).toBe(
      'Issue labels should include "triaged"',
    );
    expect(result.diffs[0]?.comparator).toBe("includes");
  });
});
