import {
  expressions,
  NormalJob,
  ReusableWorkflowCallJob,
  type GeneratedWorkflowTypes,
} from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./enhanced-step.js";

/**
 * Type for job dependencies - can be any job type or a string (job name).
 * Note: The base NormalJob.needs() accepts (NormalJob | ReusableWorkflowCallJob)[],
 * but GitHub Actions also accepts string job names directly.
 */
type JobDependency = NormalJob | ReusableWorkflowCallJob | string;

type Expression = ReturnType<typeof expressions.expn>;

/**
 * Type helper to extract outputs from a step.
 * ExtendedStep.outputs is an object mapping output names to raw path strings,
 * or undefined if no outputs are defined.
 */
type StepOutputs<S extends ExtendedStep> = S["outputs"] extends Record<string, string>
  ? S["outputs"]
  : Record<string, never>;

/**
 * Type helper to extract all step IDs from an array of steps.
 * Uses stepId property which preserves literal types.
 */
type StepIds<Steps extends readonly ExtendedStep<any, any>[]> = Steps[number]["stepId"];

/**
 * Type helper to find a step in a tuple by its stepId.
 * Uses a mapped type that creates a union of matching steps, then extracts the non-never type.
 * The key is using both directions of extends to ensure exact literal type matching.
 */
type FindStepById<
  Steps extends readonly ExtendedStep<any, any>[],
  Id extends string,
> = Steps[number] extends infer Step
  ? Step extends ExtendedStep<any, any>
    ? [Step["stepId"]] extends [Id]
      ? [Id] extends [Step["stepId"]]
        ? Step
        : never
      : never
    : never
  : never;

/**
 * Type helper to convert an array of steps to a map keyed by step ID.
 * Extracts each step's ID and maps it to that step.
 */
type StepsArrayToMap<Steps extends readonly ExtendedStep<any, any>[]> = {
  [K in StepIds<Steps>]: FindStepById<Steps, K>;
};

/**
 * Type helper to build a map of step outputs keyed by step ID.
 * Maps each key directly to the outputs object for that specific step.
 * The structure is: { [stepId]: { outputs: { [outputName]: string } } }
 * Each key maps directly to the outputs field of that step (raw paths).
 */
type StepOutputsMap<Steps extends readonly ExtendedStep<any, any>[]> = {
  [K in StepIds<Steps>]: {
    outputs: StepOutputs<FindStepById<Steps, K>>;
  };
};

/**
 * Type for the outputs function that receives step outputs map.
 * The function returns raw path strings which get wrapped in expressions.
 * The Outputs generic captures the specific return type to preserve output keys.
 */
type JobOutputsFunction<
  Steps extends readonly ExtendedStep<any, any>[],
  Outputs extends Record<string, string> = Record<string, string>,
> = (steps: StepOutputsMap<Steps>) => Outputs;

/**
 * Job outputs can be either:
 * 1. Object with expression strings (backward compatible)
 * 2. Function that receives step outputs map and returns raw paths (new approach)
 */
type JobOutputs<
  Steps extends readonly ExtendedStep<any, any>[],
  Outputs extends Record<string, string> = Record<string, string>,
> = Record<string, string> | JobOutputsFunction<Steps, Outputs>;

/**
 * A thunkable type - either a value or a function returning that value.
 * Useful for lazy evaluation or circular references.
 */
type Thunkable<T> = T | (() => T);

/**
 * Resolve a thunkable value - call it if it's a function, otherwise return as-is.
 */
function resolveThunk<T>(thunkable: Thunkable<T>): T {
  return typeof thunkable === "function" ? (thunkable as () => T)() : thunkable;
}

/**
 * Extended NormalJob class that supports function-based outputs.
 * Requires all steps to be defined upfront in the constructor.
 */
/**
 * Serializes raw output paths to expression strings for workflow YAML.
 * Wraps each raw path (e.g., "steps.x.outputs.y") in ${{ }}.
 */
function serializeOutputs(
  outputs: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(outputs)) {
    result[key] = expressions.expn(value);
  }
  return result;
}

/**
 * Builds a runtime map of step outputs from an array of ExtendedStep instances.
 * Uses each step's id property to key the map.
 * Returns raw path strings (e.g., "steps.x.outputs.y").
 */
function buildStepOutputsMap<Steps extends readonly ExtendedStep<any, any>[]>(
  steps: Steps
): StepOutputsMap<Steps> {
  const map: Record<string, { outputs: Record<string, string> }> = {};

  for (const step of steps) {
    if (!step.id) continue;

    // step.outputs is an object with raw path strings, or undefined
    map[step.id] = {
      outputs: (step.outputs as Record<string, string>) ?? {},
    };
  }

  return map as StepOutputsMap<Steps>;
}

/**
 * Helper type to extract output keys from an outputs configuration.
 * Converts Record<string, string> to readonly string[] of keys.
 */
type OutputKeys<O> = O extends Record<string, string> ? (keyof O)[] : never;

export class ExtendedNormalJob<
  const Name extends string = string,
  const Steps extends readonly ExtendedStep<any, any>[] = readonly ExtendedStep<any, any>[],
  const Outputs extends Record<string, string> = Record<string, string>,
> extends NormalJob {
  declare private readonly _jobSteps: Steps;
  declare private readonly _outputsFunction?: JobOutputsFunction<Steps, Outputs>;
  declare private readonly _outputKeys: (keyof Outputs)[];
  /**
   * Type-level property to expose output keys for type inference.
   * This is used by JobOutputExpressions in enhanced-workflow.ts.
   */
  declare readonly _outputType: Outputs;
  /**
   * Type-level property to expose the job name as a literal type.
   * This is used by JobId in enhanced-workflow.ts.
   */
  declare readonly _nameType: Name;

  constructor(
    name: Name,
    jobProps: Omit<GeneratedWorkflowTypes.NormalJob, "outputs" | "steps" | "needs"> & {
      steps: Thunkable<Steps>;
      outputs?: JobOutputs<Steps, Outputs>;
      needs?: JobDependency[];
    }
  ) {
    const { steps: stepsThunk, outputs, needs, ...restJobProps } = jobProps;
    const steps = resolveThunk(stepsThunk);

    // Validate all steps have IDs
    const stepIds = new Set<string>();
    for (const step of steps) {
      if (!step.id) {
        throw new Error(
          `All steps must have an 'id' property. Step: ${JSON.stringify(step)}`
        );
      }
      if (stepIds.has(step.id)) {
        throw new Error(
          `Duplicate step ID found: '${step.id}'. All step IDs must be unique.`
        );
      }
      stepIds.add(step.id);
    }

    // Steps without outputs are allowed - they'll have an empty outputs object in the map

    // Build outputs object from function if needed
    let finalOutputs: Record<string, string> | undefined;
    let outputsFunction: JobOutputsFunction<Steps, Outputs> | undefined;
    if (typeof outputs === "function") {
      const stepsMap = buildStepOutputsMap(steps);
      const functionResult = outputs(stepsMap);
      finalOutputs = serializeOutputs(functionResult);
      outputsFunction = outputs;
    } else {
      finalOutputs = outputs;
    }

    // Convert steps array to workflow steps array (preserving order)
    // Step class stores config in .step property, extract it for NormalJob
    const stepArray = steps.map((step) => step.step) as GeneratedWorkflowTypes.Step[];
    if (stepArray.length === 0) {
      throw new Error("At least one step is required");
    }
    const stepsTuple = stepArray as [GeneratedWorkflowTypes.Step, ...GeneratedWorkflowTypes.Step[]];

    super(name, {
      ...restJobProps,
      outputs: finalOutputs,
      steps: stepsTuple,
    });

    // Handle needs if provided
    // Cast to base class type - strings will be handled correctly at runtime
    if (needs && needs.length > 0) {
      this.needs(needs as (NormalJob | ReusableWorkflowCallJob)[]);
    }

    // Make private properties non-enumerable to prevent YAML serialization
    Object.defineProperty(this, '_jobSteps', {
      value: steps,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, '_outputsFunction', {
      value: outputsFunction,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, '_outputKeys', {
      value: finalOutputs ? Object.keys(finalOutputs) : [],
      enumerable: false,
      writable: false,
      configurable: false,
    });

    // Remove addSteps/addStep methods by overriding them to throw
    (this as any).addSteps = () => {
      throw new Error(
        "addSteps() is not supported. All steps must be defined in the constructor."
      );
    };
    (this as any).addStep = () => {
      throw new Error(
        "addStep() is not supported. All steps must be defined in the constructor."
      );
    };
  }

  /**
   * Get the steps array.
   */
  get jobSteps(): Steps {
    return this._jobSteps;
  }

  /**
   * Get the output keys for this job.
   */
  get outputKeys(): (keyof Outputs)[] {
    return this._outputKeys;
  }
}

/**
 * Helper to reference a job's outputs in a needs context.
 * Returns raw expression paths (without `${{ }}`) for composition.
 *
 * @example
 * // For ExtendedNormalJob (typed outputs):
 * const contextJob = new ExtendedNormalJob("context", {
 *   outputs: (steps) => ({
 *     is_fork: steps.context.outputs.is_fork,
 *     event_name: steps.context.outputs.event_name,
 *   }),
 * });
 *
 * const buildJob = new ReusableWorkflowCallJob("build", {
 *   with: {
 *     value: expressions.expn(needs(contextJob).outputs.is_fork),
 *   },
 * });
 *
 * // For ReusableWorkflowCallJob (untyped, dynamic outputs):
 * const discoverJob = new ReusableWorkflowCallJob("discover", { ... });
 *
 * const testJob = new ReusableWorkflowCallJob("test", {
 *   with: {
 *     services: expressions.expn(needs(discoverJob).outputs.services),
 *   },
 * });
 *
 * // For conditions (compose into expressions.expn):
 * const versionJob = new ExtendedNormalJob("version", {
 *   if: expressions.expn(`${needs(contextJob).outputs.event_name} == 'push'`),
 * });
 */

// Overload for ExtendedNormalJob with typed outputs
export function needs<
  Name extends string,
  Outputs extends Record<string, string>,
>(
  job: ExtendedNormalJob<Name, any, Outputs>
): { outputs: { [K in keyof Outputs]: string } };

// Implementation for ExtendedNormalJob only (typed outputs)
export function needs<
  Name extends string,
  Outputs extends Record<string, string>,
>(
  job: ExtendedNormalJob<Name, any, Outputs>
): { outputs: { [K in keyof Outputs]: string } } {
  const jobName = job.name;
  const outputs: Record<string, string> = {};

  for (const key of job.outputKeys) {
    outputs[key as string] = `needs.${jobName}.outputs.${key as string}`;
  }

  return { outputs } as { outputs: { [K in keyof Outputs]: string } };
}

/**
 * Helper to reference a job's output by name.
 * Use this for ReusableWorkflowCallJob or other jobs without typed outputs.
 *
 * @example
 * const discoverJob = new ReusableWorkflowCallJob("discover", { ... });
 *
 * const buildJob = new ReusableWorkflowCallJob("build", {
 *   with: {
 *     services: expressions.expn(needsOutput(discoverJob, "services")),
 *   },
 * });
 */
export function needsOutput(job: { name: string }, output: string): string {
  return `needs.${job.name}.outputs.${output}`;
}

