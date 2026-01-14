import {
  expressions,
  NormalJob,
  type GeneratedWorkflowTypes,
} from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./enhanced-step.js";

type Expression = ReturnType<typeof expressions.expn>;

/**
 * Type helper to create output expressions object from outputs array.
 */
type OutputExpressions<O extends readonly string[]> = {
  [K in O[number]]: Expression;
};

/**
 * Type helper to extract outputs from a step.
 * Directly accesses the outputs property and maps it to output expressions.
 * Preserves literal types from the outputs array.
 * ExtendedStep has two generic parameters: Id and Outputs, so we extract the second one.
 */
type StepOutputs<S extends ExtendedStep> = S extends ExtendedStep<any, infer O>
  ? O extends readonly string[]
    ? OutputExpressions<O>
    : O extends undefined
    ? Record<string, never>
    : Record<string, never>
  : Record<string, never>;

/**
 * Type helper to extract all step IDs from an array of steps.
 * Uses stepId property which preserves literal types.
 */
type StepIds<Steps extends readonly ExtendedStep[]> = Steps[number]["stepId"];

/**
 * Type helper to find a step in a tuple by its stepId.
 * Uses a mapped type that creates a union of matching steps, then extracts the non-never type.
 * The key is using both directions of extends to ensure exact literal type matching.
 */
type FindStepById<
  Steps extends readonly ExtendedStep[],
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
type StepsArrayToMap<Steps extends readonly ExtendedStep[]> = {
  [K in StepIds<Steps>]: FindStepById<Steps, K>;
};

/**
 * Type helper to build a map of step outputs keyed by step ID.
 * Maps each key directly to the outputs object for that specific step.
 * The structure is: { [stepId]: { outputs: { [outputName]: Expression } } }
 * Each key maps directly to the outputs field of that step.
 */
type StepOutputsMap<Steps extends readonly ExtendedStep[]> = {
  [K in StepIds<Steps>]: {
    outputs: StepOutputs<FindStepById<Steps, K>>;
  };
};

/**
 * Type for the outputs function that receives step outputs map.
 */
type JobOutputsFunction<Steps extends readonly ExtendedStep[]> = (
  steps: StepOutputsMap<Steps>
) => Record<string, Expression>;

/**
 * Job outputs can be either:
 * 1. Object with expression strings (backward compatible)
 * 2. Function that receives step outputs map (new approach)
 */
type JobOutputs<Steps extends readonly ExtendedStep[]> =
  | Record<string, string>
  | JobOutputsFunction<Steps>;

/**
 * Extended NormalJob class that supports function-based outputs.
 * Requires all steps to be defined upfront in the constructor.
 */
/**
 * Serializes output expressions to expression strings for workflow YAML.
 * Since Expression is already a string, this is just a type cast.
 */
function serializeOutputs(
  outputs: Record<string, Expression>
): Record<string, string> {
  // Expression is already a string (ReturnType<typeof expressions.expn>)
  return outputs as Record<string, string>;
}

/**
 * Builds a runtime map of step outputs from an array of ExtendedStep instances.
 * Uses each step's id property to key the map.
 */
function buildStepOutputsMap<Steps extends readonly ExtendedStep[]>(
  steps: Steps
): StepOutputsMap<Steps> {
  const map: Record<string, { outputs: Record<string, Expression> }> = {};

  for (const step of steps) {
    if (!step.id) continue;

    const outputExpressions: Record<string, Expression> = {};

    // Steps without outputs get an empty outputs object
    if (step.outputs && step.outputs.length > 0) {
      for (const output of step.outputs) {
        outputExpressions[output] = expressions.expn(
          `steps.${step.id}.outputs.${output}`
        );
      }
    }

    map[step.id] = { outputs: outputExpressions };
  }

  return map as StepOutputsMap<Steps>;
}

export class ExtendedNormalJob<
  const Steps extends readonly ExtendedStep[] = readonly ExtendedStep[],
> extends NormalJob {
  declare private readonly _jobSteps: Steps;
  declare private readonly _outputsFunction?: JobOutputsFunction<Steps>;

  constructor(
    name: string,
    jobProps: Omit<GeneratedWorkflowTypes.NormalJob, "outputs" | "steps"> & {
      steps: Steps;
      outputs?: JobOutputs<Steps>;
      needs?: (NormalJob | string)[];
    }
  ) {
    const { steps, outputs, needs, ...restJobProps } = jobProps;

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
    let outputsFunction: JobOutputsFunction<Steps> | undefined;
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
    if (needs && needs.length > 0) {
      this.needs(needs);
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
}


