/**
 * BaseMachine — generic base class for XState-powered machines.
 *
 * Provides common run/predict/execute/getState lifecycle methods.
 * Subclasses implement getMachine(), getDefaultEvent(), and optionally
 * getLogMessage() for state transition logging.
 */

import { createActor } from "xstate";
import type { AnyStateMachine, EventObject } from "xstate";
import type { MachineContext, Action } from "./schemas.js";
import type { Logger } from "./types.js";
import { consoleLogger } from "./types.js";
import { executeActions } from "./executor.js";
import type { RunnerContext, RunnerResult, RunnerOptions } from "./executor.js";

/**
 * Result of running the machine
 */
export interface BaseMachineResult<TState extends string = string> {
  /** Final state the machine reached */
  state: TState;
  /** Concrete actions to execute */
  actions: Action[];
  /** Full machine context snapshot */
  context: MachineContext;
}

/**
 * Options for running the machine
 */
export interface BaseRunOptions {
  /** Event to send after starting */
  event?: EventObject;
}

/**
 * Options for executing the machine (predict + run actions)
 */
export interface BaseExecuteOptions extends BaseRunOptions {
  runnerContext: RunnerContext;
  runnerOptions?: RunnerOptions;
}

/**
 * Result of executing the machine
 */
export interface BaseExecuteResult<TState extends string = string>
  extends BaseMachineResult<TState> {
  runnerResult: RunnerResult;
}

/**
 * Base class for XState-powered machines.
 *
 * Usage:
 *   class IssueMachine extends BaseMachine<IssueState> {
 *     protected getMachine() { return issueInvokeMachine; }
 *     protected getDefaultEvent() { return { type: "DETECT" }; }
 *     protected getLogMessage(state) { return STATE_LOG_MESSAGES[state]?.(this.context); }
 *   }
 */
export abstract class BaseMachine<TState extends string = string> {
  protected readonly context: MachineContext;
  protected readonly logger: Logger;

  constructor(context: MachineContext, options?: { logger?: Logger }) {
    this.context = context;
    this.logger = options?.logger ?? consoleLogger;
  }

  /** Return the XState machine definition. */
  protected abstract getMachine(): AnyStateMachine;

  /** Return the default event to send after starting. */
  protected abstract getDefaultEvent(): EventObject;

  /**
   * Return a log message for a given state name, or null to skip logging.
   * Override in subclasses to provide state-specific diagnostic logging.
   */
  protected getLogMessage(_stateName: string): string | null {
    return null;
  }

  /**
   * Run the machine: start, send event, collect actions.
   * State transitions are logged via actor.subscribe().
   */
  run(options?: BaseRunOptions): BaseMachineResult<TState> {
    const actor = createActor(this.getMachine(), {
      input: this.context,
    });

    // Log state transitions via subscription
    actor.subscribe((snapshot) => {
      const stateName = String(snapshot.value);
      const message = this.getLogMessage(stateName);
      if (message) {
        this.logger.info(message);
      }
    });

    actor.start();
    actor.send(options?.event ?? this.getDefaultEvent());

    const snapshot = actor.getSnapshot();

    return {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState snapshot.value is string; TState is declared by the subclass
      state: String(snapshot.value) as TState,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState snapshot context has pendingActions from our machine setup
      actions: (snapshot.context as { pendingActions: Action[] })
        .pendingActions,
      context: this.context,
    };
  }

  /**
   * Predict mode: run the machine with default stubs.
   * Same as run() — alias for clarity.
   */
  predict(options?: BaseRunOptions): BaseMachineResult<TState> {
    return this.run(options);
  }

  /**
   * Execute mode: run the machine to derive actions, then execute them
   * via the runner infrastructure.
   */
  async execute(
    options: BaseExecuteOptions,
  ): Promise<BaseExecuteResult<TState>> {
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
  getState(options?: BaseRunOptions): TState {
    const actor = createActor(this.getMachine(), {
      input: this.context,
    });
    actor.start();
    actor.send(options?.event ?? this.getDefaultEvent());
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- XState snapshot.value is string; TState is declared by the subclass
    return String(actor.getSnapshot().value) as TState;
  }
}
