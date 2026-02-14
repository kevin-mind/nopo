/**
 * IssueMachine class — invoke-based approach.
 *
 * Wraps the XState machine, supports predict and execute modes.
 * Execute mode delegates to executeActions() for real API calls.
 */

import { createActor } from "xstate";
import type { MachineContext, Action } from "../../core/schemas.js";
import type { Logger } from "../../core/types.js";
import { consoleLogger, routeLogAction } from "../../core/types.js";
import type { IssueState } from "../issues/states.js";
import type { IssueMachineEvent } from "../issues/events.js";
import { executeActions } from "../../runner/runner.js";
import type {
  RunnerContext,
  RunnerResult,
  RunnerOptions,
} from "../../runner/types.js";
import { issueInvokeMachine } from "./machine.js";

/**
 * Result of running the machine
 */
export interface MachineResult {
  /** Final state the machine reached */
  state: string;
  /** Concrete actions to execute */
  actions: Action[];
  /** Full machine context snapshot */
  context: MachineContext;
}

/**
 * Options for running the machine
 */
export interface RunOptions {
  /** Event to send after starting (default: DETECT) */
  event?: IssueMachineEvent;
}

/**
 * Options for executing the machine (predict + run actions)
 */
export interface ExecuteOptions extends RunOptions {
  runnerContext: RunnerContext;
  runnerOptions?: RunnerOptions;
}

/**
 * Result of executing the machine
 */
export interface ExecuteResult extends MachineResult {
  runnerResult: RunnerResult;
}

/**
 * IssueMachine wraps the invoke-based XState machine.
 *
 * Usage (predict mode - default):
 *   const machine = new IssueMachine(context);
 *   const result = machine.run();
 *
 * Usage (execute mode - with real runner):
 *   const machine = new IssueMachine(context);
 *   const result = await machine.execute({ runnerContext });
 */
export class IssueMachine {
  private readonly context: MachineContext;
  private readonly logger: Logger;

  constructor(context: MachineContext, options?: { logger?: Logger }) {
    this.context = context;
    this.logger = options?.logger ?? consoleLogger;
  }

  /**
   * Run the machine: start, send DETECT, collect actions.
   * Log actions are consumed by the injected logger instead of being
   * included in the returned action list.
   */
  run(options?: RunOptions): MachineResult {
    const actor = createActor(issueInvokeMachine, {
      input: this.context,
    });

    actor.start();
    actor.send(options?.event ?? { type: "DETECT" });

    const snapshot = actor.getSnapshot();
    const allActions = snapshot.context.pendingActions;

    // Filter out log actions — send them to the logger instead
    const actions: Action[] = [];
    for (const action of allActions) {
      if (action.type === "log") {
        routeLogAction(action, this.logger);
      } else {
        actions.push(action);
      }
    }

    return {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState snapshot.value is typed as string, but our machine only produces IssueState values
      state: snapshot.value as IssueState,
      actions,
      context: this.context,
    };
  }

  /**
   * Predict mode: run the machine with default stubs.
   * Same as run() — alias for clarity.
   */
  predict(options?: RunOptions): MachineResult {
    return this.run(options);
  }

  /**
   * Execute mode: run the machine to derive actions, then execute them
   * via the existing runner infrastructure.
   */
  async execute(options: ExecuteOptions): Promise<ExecuteResult> {
    const machineResult = this.predict(options);
    const runnerResult = await executeActions(
      machineResult.actions,
      options.runnerContext,
      options.runnerOptions,
    );
    return { ...machineResult, runnerResult };
  }

  /**
   * Get the final state without computing actions.
   */
  getState(options?: RunOptions): IssueState {
    const actor = createActor(issueInvokeMachine, {
      input: this.context,
    });
    actor.start();
    actor.send(options?.event ?? { type: "DETECT" });
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState snapshot.value is typed as string, but our machine only produces IssueState values
    return actor.getSnapshot().value as IssueState;
  }
}
