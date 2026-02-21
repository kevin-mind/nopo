/**
 * Domain Machine Runtime
 *
 * Creates the XState machine that composes domain states with the shared
 * predict-execute-verify runner.
 *
 * Queue-level batch PEV: predictions are collected up-front, all actions
 * execute sequentially, then a single persist → refresh → verify cycle
 * evaluates every prediction against the final refreshed state.
 */

import { setup, assign, fromPromise } from "xstate";
import type { EventObject } from "xstate";
import type {
  DomainMachineConfig,
  RunnerMachineContext,
  PevMachineInput,
  PevVerifyResult,
  PevVerifyReturn,
} from "./types.js";
import { RUNNER_STATES } from "./runner-states.js";
import { evaluatePredictionChecks } from "./prediction-checks.js";

function normalizeVerifyReturn(result: PevVerifyReturn): PevVerifyResult {
  if (result == null) {
    return { pass: true, message: "" };
  }
  if ("pass" in result) {
    return result;
  }
  return {
    pass: false,
    message: result.message,
    diffs: result.diffs,
  };
}

function resolveActionDescription<TAction, TDomainContext>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime registry lookup remains dynamic
  def: any,
  action: TAction,
  domain: TDomainContext,
): string | null {
  if (!def?.description) return null;
  if (typeof def.description === "function") {
    const value = def.description(action, domain);
    return typeof value === "string" && value.length > 0 ? value : null;
  }
  return typeof def.description === "string" && def.description.length > 0
    ? def.description
    : null;
}

function cloneDomainSnapshot<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, current) =>
      typeof current === "function" ? undefined : current,
    ),
  );
}

/**
 * Error thrown when batch execution fails mid-queue.
 * Carries the partial results so completed actions can be tracked.
 */
class BatchExecuteError extends Error {
  constructor(
    message: string,
    public readonly completedResults: Array<{
      action: { type: string };
      executeResult: unknown;
    }>,
    public readonly failedAction: { type: string },
  ) {
    super(message);
    this.name = "BatchExecuteError";
  }
}

function buildRunnerStates<TDomainContext, TAction extends { type: string }>(
  configId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- action registry lookup is runtime-typed
  actionRegistry: Record<string, any>,
  hasActionFailureState: boolean,
  hasBeforeQueue: boolean,
): Record<string, unknown> {
  type Ctx = RunnerMachineContext<TDomainContext, TAction>;
  const actionFailureTarget = hasActionFailureState
    ? `#${configId}.actionFailure`
    : `#${configId}.${RUNNER_STATES.executionFailed}`;
  const verificationFailureTarget = hasActionFailureState
    ? `#${configId}.actionFailure`
    : `#${configId}.${RUNNER_STATES.verificationFailed}`;

  // Synchronous assign that collects predictions from all queued actions
  // and moves them into queuePredictions, clearing the action queue.
  const collectPredictionsAssign = assign({
    queuePredictions: ({ context }: { context: Ctx }) => {
      const preSnapshot = cloneDomainSnapshot(context.domain);
      return context.actionQueue.map((action) => {
        const def = actionRegistry[action.type];
        const prediction =
          def?.predict != null ? def.predict(action, context.domain) : null;
        return {
          action,
          prediction,
          preSnapshot,
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState assign callback needs compatible type
          executeResult: null as unknown,
        };
      });
    },
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState assign callback needs compatible type
    actionQueue: () => [] as TAction[],
    // Reset stale verifyResult from any previous queue cycle
    verifyResult: () => null,
    error: () => null,
    // Track where this queue's completedActions start (so afterQueue gets only this queue's results)
    _queueStartIndex: ({ context }: { context: Ctx }) =>
      context.completedActions.length,
  });

  // When the queue is empty and we skip straight to queueComplete, we still need
  // to set _queueStartIndex so afterQueue gets an empty slice (not stale prior results).
  const setQueueStartIndex = assign({
    _queueStartIndex: ({ context }: { context: Ctx }) =>
      context.completedActions.length,
  });

  // When beforeQueue is configured, executingQueue first invokes it and persists,
  // then proceeds to collecting predictions. Without beforeQueue, skip straight to collecting.
  const executingQueueState = hasBeforeQueue
    ? {
        initial: "startingQueue",
        states: {
          startingQueue: {
            invoke: {
              src: "startBeforeQueue",
              input: ({ context }: { context: Ctx }) => ({
                runnerCtx: context.runnerCtx,
                domain: context.domain,
                queueLabel: context.queueLabel,
              }),
              onDone: [
                {
                  guard: "queueEmpty",
                  target: `#${configId}.${RUNNER_STATES.queueComplete}`,
                  actions: setQueueStartIndex,
                },
                { target: "collectingPredictions" },
              ],
              onError: "collectingPredictions",
            },
          },
          collectingPredictions: {
            always: [
              {
                guard: "queueEmpty",
                target: `#${configId}.${RUNNER_STATES.queueComplete}`,
                actions: setQueueStartIndex,
              },
              {
                target: `#${configId}.${RUNNER_STATES.executingBatch}`,
                actions: collectPredictionsAssign,
              },
            ],
          },
        },
      }
    : {
        always: [
          {
            guard: "queueEmpty",
            target: RUNNER_STATES.queueComplete,
            actions: setQueueStartIndex,
          },
          {
            target: RUNNER_STATES.executingBatch,
            actions: collectPredictionsAssign,
          },
        ],
      };

  return {
    [RUNNER_STATES.executingQueue]: executingQueueState,

    [RUNNER_STATES.executingBatch]: {
      invoke: {
        src: "executeBatchActions",
        input: ({ context }: { context: Ctx }) => ({
          queuePredictions: context.queuePredictions,
          domain: context.domain,
          services: context.services,
        }),
        onDone: {
          target: RUNNER_STATES.persistingBatch,
          actions: assign({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onDone event type not inferrable in factory
            queuePredictions: ({ context, event }: any) => {
              const results: unknown[] = event.output;
              return context.queuePredictions.map(
                (entry: Ctx["queuePredictions"][number], i: number) => ({
                  ...entry,
                  executeResult: results[i],
                }),
              );
            },
            currentAction: () => null,
          }),
        },
        onError: {
          target: actionFailureTarget,
          actions: assign({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onError event type not inferrable in factory
            error: ({ event }: any) =>
              event.error instanceof Error
                ? event.error.message
                : String(event.error),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onError event type not inferrable in factory
            currentAction: ({ event }: any) =>
              event.error instanceof BatchExecuteError
                ? event.error.failedAction
                : null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onError event type not inferrable in factory
            completedActions: ({ context, event }: any) => {
              if (event.error instanceof BatchExecuteError) {
                return [
                  ...context.completedActions,
                  ...event.error.completedResults.map(
                    (r: { action: TAction; executeResult: unknown }) => ({
                      action: r.action,
                      result: r.executeResult,
                      verified: false,
                    }),
                  ),
                ];
              }
              return context.completedActions;
            },
          }),
        },
      },
    },

    [RUNNER_STATES.persistingBatch]: {
      invoke: {
        src: "persistBatchContext",
        input: ({ context }: { context: Ctx }) => ({
          runnerCtx: context.runnerCtx,
          domain: context.domain,
        }),
        onDone: RUNNER_STATES.refreshingContext,
        onError: RUNNER_STATES.refreshingContext,
      },
    },

    [RUNNER_STATES.refreshingContext]: {
      invoke: {
        src: "refreshBatchContext",
        input: ({ context }: { context: Ctx }) => ({
          runnerCtx: context.runnerCtx,
          domain: context.domain,
        }),
        onDone: {
          target: RUNNER_STATES.verifyingBatch,
          actions: assign({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onDone event type not inferrable in factory
            domain: ({ event }: any) => event.output,
          }),
        },
        onError: {
          target: verificationFailureTarget,
          actions: assign({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onError event type not inferrable in factory
            error: ({ event }: any) =>
              event.error instanceof Error
                ? `Context refresh failed: ${event.error.message}`
                : `Context refresh failed: ${String(event.error)}`,
          }),
        },
      },
    },

    [RUNNER_STATES.verifyingBatch]: {
      invoke: {
        src: "verifyBatchActions",
        input: ({ context }: { context: Ctx }) => ({
          queuePredictions: context.queuePredictions,
          newCtx: context.domain,
        }),
        onDone: [
          {
            guard: ({
              event,
            }: {
              event: {
                output: {
                  completedActions: Ctx["completedActions"];
                  firstFailure: PevVerifyResult | null;
                };
              };
            }) => event.output.firstFailure !== null,
            target: verificationFailureTarget,
            actions: assign({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onDone event type not inferrable in factory
              completedActions: ({ context, event }: any) => [
                ...context.completedActions,
                ...event.output.completedActions,
              ],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onDone event type not inferrable in factory
              verifyResult: ({ event }: any) => event.output.firstFailure,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onDone event type not inferrable in factory
              error: ({ event }: any) =>
                `Verification failed: ${event.output.firstFailure.message}`,
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState assign callback needs compatible type
              queuePredictions: () => [] as Ctx["queuePredictions"],
            }),
          },
          {
            target: RUNNER_STATES.queueComplete,
            actions: assign({
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onDone event type not inferrable in factory
              completedActions: ({ context, event }: any) => [
                ...context.completedActions,
                ...event.output.completedActions,
              ],
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState assign callback needs compatible type
              queuePredictions: () => [] as Ctx["queuePredictions"],
            }),
          },
        ],
        onError: {
          target: verificationFailureTarget,
          actions: assign({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onError event type not inferrable in factory
            error: ({ event }: any) =>
              event.error instanceof Error
                ? event.error.message
                : String(event.error),
          }),
        },
      },
    },

    [RUNNER_STATES.queueComplete]: {
      entry: [
        assign({
          cycleCount: ({ context }: { context: Ctx }) => context.cycleCount + 1,
        }),
        "__runAfterQueue",
      ],
      initial: "persisting",
      states: {
        persisting: {
          invoke: {
            src: "persistAfterQueue",
            input: ({ context }: { context: Ctx }) => ({
              runnerCtx: context.runnerCtx,
              domain: context.domain,
            }),
            onDone: "routable",
            onError: "routable",
          },
        },
        routable: {
          always: [
            {
              guard: "maxCyclesReached",
              target: `#${configId}.${RUNNER_STATES.done}`,
            },
            {
              target: `#${configId}.routing`,
            },
          ],
        },
      },
    },

    [RUNNER_STATES.executionFailed]: {
      type: "final",
    },

    [RUNNER_STATES.verificationFailed]: {
      type: "final",
    },

    [RUNNER_STATES.done]: {
      type: "final",
    },
  };
}

export function createDomainMachine<
  TDomainContext,
  TAction extends { type: string },
  TEvent extends EventObject = EventObject,
>(config: DomainMachineConfig<TDomainContext, TAction, TEvent>) {
  type Ctx = RunnerMachineContext<TDomainContext, TAction>;

  const runnerGuards: Record<string, (args: { context: Ctx }) => boolean> = {
    queueEmpty: ({ context }) => context.actionQueue.length === 0,
    maxCyclesReached: ({ context }) => context.cycleCount >= context.maxCycles,
  };

  const allGuards = {
    ...runnerGuards,
    ...config.guards,
  };

  const runnerStates = buildRunnerStates<TDomainContext, TAction>(
    config.id,
    config.actionRegistry,
    "actionFailure" in config.domainStates,
    Boolean(config.beforeQueue),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- XState factory composition
  const allStates: any = {
    ...config.domainStates,
    ...runnerStates,
  };

  return setup({
    types: {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState setup requires type assertions
      context: {} as Ctx,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState setup requires type assertions
      events: {} as TEvent,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState setup requires type assertions
      input: {} as PevMachineInput<TDomainContext>,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions -- XState guard types can't be composed generically
    guards: allGuards as any,
    actors: {
      executeBatchActions: fromPromise(
        async ({
          input,
        }: {
          input: {
            queuePredictions: Ctx["queuePredictions"];
            domain: TDomainContext;
            services: Ctx["services"];
          };
        }) => {
          const results: unknown[] = [];
          for (const entry of input.queuePredictions) {
            const def = config.actionRegistry[entry.action.type];
            if (!def) {
              throw new BatchExecuteError(
                `No action definition for type: ${entry.action.type}`,
                results.map((r, i) => ({
                  action: input.queuePredictions[i]!.action,
                  executeResult: r,
                })),
                entry.action,
              );
            }
            const actionDescription = resolveActionDescription(
              def,
              entry.action,
              input.domain,
            );
            if (actionDescription) {
              console.info(`[PEV] ${actionDescription}`);
            }
            if (entry.prediction?.description) {
              console.info(`[PEV predict] ${entry.prediction.description}`);
            }
            try {
              const result = await def.execute({
                action: entry.action,
                ctx: input.domain,
                services: input.services,
              });
              results.push(result);
            } catch (err: unknown) {
              throw new BatchExecuteError(
                err instanceof Error ? err.message : String(err),
                results.map((r, i) => ({
                  action: input.queuePredictions[i]!.action,
                  executeResult: r,
                })),
                entry.action,
              );
            }
          }
          return results;
        },
      ),
      startBeforeQueue: fromPromise(
        async ({
          input,
        }: {
          input: {
            runnerCtx: Ctx["runnerCtx"];
            domain: TDomainContext;
            queueLabel: string | null;
          };
        }) => {
          if (config.beforeQueue) {
            await config.beforeQueue(
              input.runnerCtx,
              input.domain,
              input.queueLabel,
            );
            if (config.persistContext) {
              await config.persistContext(input.runnerCtx, input.domain);
            }
          }
        },
      ),
      persistBatchContext: fromPromise(
        async ({
          input,
        }: {
          input: {
            runnerCtx: Ctx["runnerCtx"];
            domain: TDomainContext;
          };
        }) => {
          if (config.persistContext) {
            console.info("[PEV] Persisting state before verify");
            await config.persistContext(input.runnerCtx, input.domain);
          }
        },
      ),
      refreshBatchContext: fromPromise(
        async ({
          input,
        }: {
          input: {
            runnerCtx: Ctx["runnerCtx"];
            domain: TDomainContext;
          };
        }) => {
          return config.refreshContext(input.runnerCtx, input.domain);
        },
      ),
      verifyBatchActions: fromPromise(
        async ({
          input,
        }: {
          input: {
            queuePredictions: Ctx["queuePredictions"];
            newCtx: TDomainContext;
          };
        }): Promise<{
          completedActions: Ctx["completedActions"];
          firstFailure: PevVerifyResult | null;
        }> => {
          const completedActions: Ctx["completedActions"] = [];
          let firstFailure: PevVerifyResult | null = null;

          for (const entry of input.queuePredictions) {
            const def = config.actionRegistry[entry.action.type];

            const predictionEval = evaluatePredictionChecks(
              entry.prediction?.checks,
              entry.preSnapshot,
              input.newCtx,
            );

            const defaultVerify: PevVerifyResult = predictionEval.pass
              ? {
                  pass: true,
                  message:
                    entry.prediction?.checks &&
                    entry.prediction.checks.length > 0
                      ? "Prediction checks passed"
                      : "No checks defined — auto-pass",
                }
              : {
                  pass: false,
                  message: "Prediction checks failed",
                  diffs: predictionEval.diffs,
                };

            if (!def?.verify) {
              completedActions.push({
                action: entry.action,
                result: entry.executeResult,
                verified: defaultVerify.pass,
              });
              if (!defaultVerify.pass && firstFailure === null) {
                firstFailure = defaultVerify;
              }
              if (defaultVerify.message) {
                const prefix = defaultVerify.pass
                  ? "[PEV verify]"
                  : "[PEV verify fail]";
                console.info(
                  `${prefix} ${entry.action.type}: ${defaultVerify.message}`,
                );
              }
              continue;
            }

            const customReturn: PevVerifyReturn = def.verify({
              action: entry.action,
              oldCtx: entry.preSnapshot,
              newCtx: input.newCtx,
              prediction: entry.prediction,
              predictionEval,
              predictionDiffs: predictionEval.diffs,
              executeResult: entry.executeResult,
            });
            const customResult = normalizeVerifyReturn(customReturn);

            const verifyResult: PevVerifyResult = {
              pass: predictionEval.pass && customResult.pass,
              message:
                predictionEval.pass || !entry.prediction?.checks?.length
                  ? customResult.message
                  : `${customResult.message} | Prediction checks failed`,
              diffs: [
                ...(customResult.diffs ?? []),
                ...(predictionEval.pass ? [] : predictionEval.diffs),
              ],
            };

            completedActions.push({
              action: entry.action,
              result: entry.executeResult,
              verified: verifyResult.pass,
            });

            if (!verifyResult.pass && firstFailure === null) {
              firstFailure = verifyResult;
            }

            if (verifyResult.message) {
              const prefix = verifyResult.pass
                ? "[PEV verify]"
                : "[PEV verify fail]";
              console.info(
                `${prefix} ${entry.action.type}: ${verifyResult.message}`,
              );
            }
          }
          return { completedActions, firstFailure };
        },
      ),
      persistAfterQueue: fromPromise(
        async ({
          input,
        }: {
          input: {
            runnerCtx: Ctx["runnerCtx"];
            domain: TDomainContext;
          };
        }) => {
          if (config.persistContext) {
            console.info("[PEV] Auto-persisting state after queue drain");
            await config.persistContext(input.runnerCtx, input.domain);
          }
        },
      ),
    },
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState action types can't be composed generically
    actions: {
      ...(config.actions ?? {}),
      __runAfterQueue: ({ context }: { context: Ctx }) => {
        if (config.afterQueue) {
          // Only pass this queue's completedActions, not accumulated from prior cycles
          const queueActions = context.completedActions.slice(
            context._queueStartIndex,
          );
          config.afterQueue(
            context.runnerCtx,
            context.domain,
            context.queueLabel,
            queueActions,
            context.error,
          );
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  }).createMachine({
    id: config.id,
    initial: "routing",
    context: ({ input }) => ({
      domain: input.domain,
      services: input.services,
      actionQueue: [] satisfies TAction[],
      currentAction: null,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState context init needs compatible type
      queuePredictions: [] as Ctx["queuePredictions"],
      verifyResult: null,
      completedActions: [] satisfies Array<{
        action: TAction;
        result: unknown;
        verified: boolean;
      }>,
      cycleCount: 0,
      maxCycles: input.maxCycles ?? 1,
      error: null,
      queueLabel: null,
      _queueStartIndex: 0,
      runnerCtx: input.runnerCtx,
    }),

    states: allStates,
  });
}
