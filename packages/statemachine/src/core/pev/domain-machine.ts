/**
 * Domain Machine Runtime
 *
 * Creates the XState machine that composes domain states with the shared
 * predict-execute-verify runner.
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

  // When beforeQueue is configured, executingQueue first invokes it and persists,
  // then proceeds to dequeuing actions. Without beforeQueue, skip straight to dequeuing.
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
                },
                { target: "dequeuing" },
              ],
              onError: "dequeuing",
            },
          },
          dequeuing: {
            always: [
              {
                guard: "queueEmpty",
                target: `#${configId}.${RUNNER_STATES.queueComplete}`,
              },
              {
                target: `#${configId}.${RUNNER_STATES.runningAction}`,
                actions: assign({
                  currentAction: ({ context }: { context: Ctx }) =>
                    context.actionQueue[0] ?? null,
                  actionQueue: ({ context }: { context: Ctx }) =>
                    context.actionQueue.slice(1),
                  prediction: ({ context }: { context: Ctx }) => {
                    const action = context.actionQueue[0];
                    if (!action) return null;
                    const def = actionRegistry[action.type];
                    if (!def?.predict) return null;
                    return def.predict(action, context.domain);
                  },
                  preActionSnapshot: ({ context }: { context: Ctx }) =>
                    cloneDomainSnapshot(context.domain),
                  executeResult: () => null,
                  verifyResult: () => null,
                }),
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
          },
          {
            target: RUNNER_STATES.runningAction,
            actions: assign({
              currentAction: ({ context }: { context: Ctx }) =>
                context.actionQueue[0] ?? null,
              actionQueue: ({ context }: { context: Ctx }) =>
                context.actionQueue.slice(1),
              prediction: ({ context }: { context: Ctx }) => {
                const action = context.actionQueue[0];
                if (!action) return null;
                const def = actionRegistry[action.type];
                if (!def?.predict) return null;
                return def.predict(action, context.domain);
              },
              preActionSnapshot: ({ context }: { context: Ctx }) =>
                cloneDomainSnapshot(context.domain),
              executeResult: () => null,
              verifyResult: () => null,
            }),
          },
        ],
      };

  return {
    [RUNNER_STATES.executingQueue]: executingQueueState,

    [RUNNER_STATES.runningAction]: {
      initial: "executing",
      states: {
        executing: {
          invoke: {
            src: "executeAction",
            input: ({ context }: { context: Ctx }) => ({
              action: context.currentAction!,
              domain: context.domain,
              services: context.services,
              prediction: context.prediction,
            }),
            onDone: {
              target: "verifying",
              actions: assign({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onDone event type not inferrable in factory
                executeResult: ({ event }: any) => event.output,
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
              }),
            },
          },
        },
        verifying: {
          invoke: {
            src: "verifyAction",
            input: ({ context }: { context: Ctx }) => ({
              action: context.currentAction!,
              runnerCtx: context.runnerCtx,
              domain: context.domain,
              preActionSnapshot: context.preActionSnapshot!,
              prediction: context.prediction,
              executeResult: context.executeResult,
            }),
            onDone: [
              {
                guard: ({
                  event,
                }: {
                  event: {
                    output: {
                      verifyResult: PevVerifyResult;
                      newContext: TDomainContext;
                    };
                  };
                }) => event.output.verifyResult.pass === true,
                // After verify pass, go back to dequeuing (skip beforeQueue on subsequent actions)
                target: hasBeforeQueue
                  ? `#${configId}.${RUNNER_STATES.executingQueue}.dequeuing`
                  : `#${configId}.${RUNNER_STATES.executingQueue}`,
                actions: assign({
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onDone event type not inferrable in factory
                  verifyResult: ({ event }: any) => event.output.verifyResult,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onDone event type not inferrable in factory
                  domain: ({ event }: any) => event.output.newContext,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onDone event type not inferrable in factory
                  completedActions: ({ context, event }: any) => [
                    ...context.completedActions,
                    {
                      action: context.currentAction!,
                      result: context.executeResult,
                      verified: event.output.verifyResult.pass,
                    },
                  ],
                  currentAction: () => null,
                  prediction: () => null,
                  preActionSnapshot: () => null,
                }),
              },
              {
                target: verificationFailureTarget,
                actions: assign({
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onDone event type not inferrable in factory
                  verifyResult: ({ event }: any) => event.output.verifyResult,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onDone event type not inferrable in factory
                  error: ({ event }: any) =>
                    `Verification failed: ${event.output.verifyResult.message}`,
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
      executeAction: fromPromise(
        async ({
          input,
        }: {
          input: {
            action: TAction;
            domain: TDomainContext;
            services: Ctx["services"];
            prediction: Ctx["prediction"];
          };
        }) => {
          const def = config.actionRegistry[input.action.type];
          if (!def) {
            throw new Error(
              `No action definition for type: ${input.action.type}`,
            );
          }
          const actionDescription = resolveActionDescription(
            def,
            input.action,
            input.domain,
          );
          if (actionDescription) {
            console.info(`[PEV] ${actionDescription}`);
          }
          if (input.prediction?.description) {
            console.info(`[PEV predict] ${input.prediction.description}`);
          }
          return def.execute({
            action: input.action,
            ctx: input.domain,
            services: input.services,
          });
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
            config.beforeQueue(input.runnerCtx, input.domain, input.queueLabel);
            if (config.persistContext) {
              await config.persistContext(input.runnerCtx, input.domain);
            }
          }
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
      verifyAction: fromPromise(
        async ({
          input,
        }: {
          input: {
            action: TAction;
            runnerCtx: Ctx["runnerCtx"];
            domain: TDomainContext;
            preActionSnapshot: TDomainContext;
            prediction: Ctx["prediction"];
            executeResult: Ctx["executeResult"];
          };
        }): Promise<{
          verifyResult: PevVerifyResult;
          newContext: TDomainContext;
        }> => {
          const newCtx = await config.refreshContext(
            input.runnerCtx,
            input.domain,
          );

          const def = config.actionRegistry[input.action.type];
          const predictionEval = evaluatePredictionChecks(
            input.prediction?.checks,
            input.preActionSnapshot,
            newCtx,
          );
          const defaultVerify: PevVerifyResult = predictionEval.pass
            ? {
                pass: true,
                message:
                  input.prediction?.checks && input.prediction.checks.length > 0
                    ? "Prediction checks passed"
                    : "No checks defined — auto-pass",
              }
            : {
                pass: false,
                message: "Prediction checks failed",
                diffs: predictionEval.diffs,
              };
          if (!def?.verify) {
            return {
              verifyResult: defaultVerify,
              newContext: newCtx,
            };
          }

          const customReturn: PevVerifyReturn = def.verify({
            action: input.action,
            oldCtx: input.preActionSnapshot,
            newCtx,
            prediction: input.prediction,
            predictionEval,
            predictionDiffs: predictionEval.diffs,
            executeResult: input.executeResult,
          });
          const customResult = normalizeVerifyReturn(customReturn);

          const verifyResult: PevVerifyResult = {
            pass: predictionEval.pass && customResult.pass,
            message:
              predictionEval.pass || !input.prediction?.checks?.length
                ? customResult.message
                : `${customResult.message} | Prediction checks failed`,
            diffs: [
              ...(customResult.diffs ?? []),
              ...(predictionEval.pass ? [] : predictionEval.diffs),
            ],
          };
          if (verifyResult.message) {
            const prefix = verifyResult.pass
              ? "[PEV verify]"
              : "[PEV verify fail]";
            console.info(`${prefix} ${verifyResult.message}`);
          }
          return { verifyResult, newContext: newCtx };
        },
      ),
    },
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState action types can't be composed generically
    actions: {
      ...(config.actions ?? {}),
      __runAfterQueue: ({ context }: { context: Ctx }) => {
        if (config.afterQueue) {
          config.afterQueue(
            context.runnerCtx,
            context.domain,
            context.queueLabel,
            context.completedActions,
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
      prediction: null,
      preActionSnapshot: null,
      executeResult: null,
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
      runnerCtx: input.runnerCtx,
    }),

    states: allStates,
  });
}
