import {
  expressions,
  Workflow,
  NormalJob,
  ReusableWorkflowCallJob,
  type GeneratedWorkflowTypes,
} from "@github-actions-workflow-ts/lib";
import { ExtendedNormalJob } from "./enhanced-job.js";

type Expression = ReturnType<typeof expressions.expn>;

/**
 * A thunkable type - either a value or a function returning that value.
 */
type Thunkable<T> = T | (() => T);

/**
 * Resolve a thunkable value - call it if it's a function, otherwise return as-is.
 */
function resolveThunk<T>(thunkable: Thunkable<T>): T {
  return typeof thunkable === "function" ? (thunkable as () => T)() : thunkable;
}

/**
 * Supported job types for workflows.
 */
type WorkflowJob = NormalJob | ReusableWorkflowCallJob | ExtendedNormalJob;

/**
 * Jobs configuration as an object where keys are job IDs.
 */
type JobsObject = Record<string, WorkflowJob>;

/**
 * Type helper to extract outputs from a job.
 * For ExtendedNormalJob, uses the _outputType property which preserves specific output keys.
 * For other jobs, falls back to inferring from job.outputs.
 */
type JobOutputExpressions<J extends WorkflowJob> = J extends ExtendedNormalJob<any, any, infer Outputs>
  ? Outputs extends Record<string, any>
    ? { [K in keyof Outputs]: Expression }
    : Record<string, never>
  : J extends { job: { outputs?: infer O } }
    ? NonNullable<O> extends Record<string, string>
      ? { [K in keyof NonNullable<O>]: Expression }
      : Record<string, never>
    : Record<string, never>;

/**
 * Type helper to build a map of job outputs keyed by job name.
 * The structure is: { [jobName]: { outputs: { [outputName]: Expression } } }
 */
type JobOutputsMap<Jobs extends JobsObject> = {
  [K in keyof Jobs]: {
    outputs: JobOutputExpressions<Jobs[K]>;
  };
};

/**
 * Build a runtime map of job outputs from an object of jobs.
 */
function buildJobOutputsMap<Jobs extends JobsObject>(
  jobs: Jobs
): JobOutputsMap<Jobs> {
  const map: Record<string, { outputs: Record<string, Expression> }> = {};

  for (const [jobId, job] of Object.entries(jobs)) {
    const outputExpressions: Record<string, Expression> = {};

    // Extract outputs from the job - check for job.job?.outputs (NormalJob structure)
    const jobConfig = (job as any).job;
    const jobOutputs = jobConfig?.outputs;
    if (jobOutputs && typeof jobOutputs === "object") {
      for (const outputName of Object.keys(jobOutputs)) {
        outputExpressions[outputName] = expressions.expn(
          `jobs.${jobId}.outputs.${outputName}`
        );
      }
    }

    map[jobId] = { outputs: outputExpressions };
  }

  return map as JobOutputsMap<Jobs>;
}

/**
 * Convert jobs object to array for the base Workflow class.
 * Renames each job to use the object key as its ID.
 */
function jobsObjectToArray(jobs: JobsObject): (NormalJob | ReusableWorkflowCallJob)[] {
  const result: (NormalJob | ReusableWorkflowCallJob)[] = [];

  for (const [jobId, job] of Object.entries(jobs)) {
    if (job instanceof NormalJob || job instanceof ReusableWorkflowCallJob) {
      // Create a new job with the correct name from the object key
      // We need to rename the job to match the object key
      const jobWithCorrectName = Object.create(Object.getPrototypeOf(job));
      Object.assign(jobWithCorrectName, job);
      // Override the name property
      Object.defineProperty(jobWithCorrectName, "name", {
        value: jobId,
        writable: false,
        enumerable: true,
        configurable: true,
      });
      result.push(jobWithCorrectName);
    }
  }

  return result;
}

/**
 * Workflow props without jobs (those are added separately).
 */
type WorkflowPropsWithoutJobs = Omit<Partial<GeneratedWorkflowTypes.Workflow>, "jobs">;

/**
 * Extended Workflow class that supports inline job definitions as an object.
 *
 * @example
 * ```ts
 * const workflow = new ExtendedWorkflow("my-workflow", {
 *   name: "My Workflow",
 *   on: { push: { branches: ["main"] } },
 *   jobs: {
 *     build: buildJob,
 *     test: testJob,
 *   },
 * });
 * ```
 */
export class ExtendedWorkflow<
  const Jobs extends JobsObject = JobsObject,
> extends Workflow {
  declare private readonly _workflowJobs: Jobs;

  constructor(
    filename: string,
    workflowProps: WorkflowPropsWithoutJobs & {
      jobs: Thunkable<Jobs>;
    }
  ) {
    const { jobs: jobsThunk, ...restProps } = workflowProps;
    const jobs = resolveThunk(jobsThunk);

    // Call parent constructor without jobs
    super(filename, restProps);

    // Add jobs using the parent's addJobs method
    this.addJobs(jobsObjectToArray(jobs));

    // Store jobs for potential type access
    Object.defineProperty(this, "_workflowJobs", {
      value: jobs,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  /**
   * Get the jobs object.
   */
  get workflowJobs(): Jobs {
    return this._workflowJobs;
  }
}

// =============================================================================
// REUSABLE WORKFLOW (workflow_call) TYPES
// =============================================================================

/**
 * Input definition for workflow_call.
 */
type WorkflowInput = {
  description?: string;
  required?: boolean;
  type: "boolean" | "number" | "string";
  default?: boolean | number | string;
};

/**
 * Inputs configuration for workflow_call.
 */
type WorkflowInputs = Record<string, WorkflowInput>;

/**
 * Maps workflow inputs to expression strings.
 * Each input becomes `${{ inputs.{name} }}`.
 */
type InputExpressions<Inputs extends WorkflowInputs> = {
  [K in keyof Inputs]: Expression;
};

/**
 * Build a runtime map of input expressions from inputs configuration.
 */
function buildInputExpressionsMap<Inputs extends WorkflowInputs>(
  inputs: Inputs
): InputExpressions<Inputs> {
  const map: Record<string, Expression> = {};
  for (const inputName of Object.keys(inputs)) {
    map[inputName] = expressions.expn(`inputs.${inputName}`);
  }
  return map as InputExpressions<Inputs>;
}

/**
 * Jobs can be either:
 * 1. Direct jobs object
 * 2. Thunk returning jobs (for lazy evaluation)
 * 3. Function receiving inputs and returning jobs (for typed input access)
 */
type JobsWithInputs<Inputs extends WorkflowInputs, Jobs extends JobsObject> =
  | Jobs
  | (() => Jobs)
  | ((inputs: InputExpressions<Inputs>) => Jobs);

/**
 * Resolve jobs with inputs - handles direct objects, thunks, and input functions.
 */
function resolveJobsWithInputs<Inputs extends WorkflowInputs, Jobs extends JobsObject>(
  jobsThunk: JobsWithInputs<Inputs, Jobs>,
  inputExpressions: InputExpressions<Inputs>
): Jobs {
  if (typeof jobsThunk !== "function") {
    return jobsThunk;
  }
  // Check if the function expects an argument (input function vs thunk)
  // Function.length gives the number of declared parameters
  if (jobsThunk.length > 0) {
    return (jobsThunk as (inputs: InputExpressions<Inputs>) => Jobs)(inputExpressions);
  }
  return (jobsThunk as () => Jobs)();
}

/**
 * Output definition for workflow_call.
 */
type WorkflowOutput = {
  description?: string;
  value: string;
};

/**
 * Function that receives job outputs map and returns workflow outputs.
 */
type WorkflowOutputsFunction<Jobs extends JobsObject> = (
  jobs: JobOutputsMap<Jobs>
) => Record<string, { description?: string; value: Expression }>;

/**
 * Serialize workflow outputs (Expression values to strings).
 */
function serializeWorkflowOutputs(
  outputs: Record<string, { description?: string; value: Expression }>
): Record<string, WorkflowOutput> {
  const result: Record<string, WorkflowOutput> = {};
  for (const [key, output] of Object.entries(outputs)) {
    result[key] = {
      description: output.description,
      value: output.value as string, // Expression is already a string
    };
  }
  return result;
}

/**
 * Props for ExtendedInputWorkflow excluding computed outputs.
 */
type InputWorkflowProps<
  Inputs extends WorkflowInputs,
  Jobs extends JobsObject,
> = Omit<Partial<GeneratedWorkflowTypes.Workflow>, "on" | "jobs"> & {
  /**
   * Workflow inputs for workflow_call.
   */
  inputs: Inputs;
  /**
   * Jobs to include in the workflow, keyed by job ID.
   * Can be:
   * - Direct jobs object
   * - Thunk `() => jobs` for lazy evaluation
   * - Function `(inputs) => jobs` for typed input access
   */
  jobs: JobsWithInputs<Inputs, Jobs>;
  /**
   * Function to define workflow outputs based on job outputs.
   */
  outputs?: WorkflowOutputsFunction<Jobs>;
};

/**
 * Extended Workflow class for reusable workflows with workflow_call.
 * Provides typed inputs and outputs with seamless piping.
 *
 * @example
 * ```ts
 * const buildWorkflow = new ExtendedInputWorkflow("_build", {
 *   name: "Build",
 *   inputs: {
 *     push: { description: "Whether to push", type: "boolean", required: true },
 *     services: { description: "Services to build", type: "string", default: "" },
 *   },
 *   jobs: {
 *     build: buildJob,
 *   },
 *   outputs: (jobs) => ({
 *     tag: {
 *       description: "The Docker tag",
 *       value: jobs.build.outputs.tag,
 *     },
 *     digest: {
 *       description: "The image digest",
 *       value: jobs.build.outputs.digest,
 *     },
 *   }),
 * });
 * ```
 */
export class ExtendedInputWorkflow<
  const Inputs extends WorkflowInputs = WorkflowInputs,
  const Jobs extends JobsObject = JobsObject,
> extends Workflow {
  declare private readonly _workflowJobs: Jobs;
  declare private readonly _inputs: Inputs;

  constructor(
    filename: string,
    workflowProps: InputWorkflowProps<Inputs, Jobs>
  ) {
    const { inputs, jobs: jobsThunk, outputs: outputsFunction, ...restProps } = workflowProps;

    // Build input expressions map and resolve jobs (passing inputs if function accepts them)
    const inputExpressions = buildInputExpressionsMap(inputs);
    const jobs = resolveJobsWithInputs(jobsThunk, inputExpressions);

    // Build the workflow_call configuration
    const workflowCallConfig: GeneratedWorkflowTypes.Workflow["on"] = {
      workflow_call: {
        inputs: inputs as Record<string, {
          description?: string;
          required?: boolean;
          type: "boolean" | "number" | "string";
          default?: boolean | number | string;
        }>,
      },
    };

    // If outputs function provided, compute outputs from jobs
    if (outputsFunction) {
      const jobsMap = buildJobOutputsMap(jobs);
      const computedOutputs = outputsFunction(jobsMap);
      (workflowCallConfig as any).workflow_call.outputs = serializeWorkflowOutputs(computedOutputs);
    }

    // Call parent constructor with workflow_call on
    super(filename, {
      ...restProps,
      on: workflowCallConfig,
    });

    // Add jobs using the parent's addJobs method
    this.addJobs(jobsObjectToArray(jobs));

    // Store for type access
    Object.defineProperty(this, "_workflowJobs", {
      value: jobs,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, "_inputs", {
      value: inputs,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  /**
   * Get the jobs object.
   */
  get workflowJobs(): Jobs {
    return this._workflowJobs;
  }

  /**
   * Get the inputs configuration.
   */
  get workflowInputs(): Inputs {
    return this._inputs;
  }
}
