import {
  Step,
  type GeneratedWorkflowTypes,
} from "@github-actions-workflow-ts/lib";

/**
 * Maps an array of output names to an object with those names as keys
 * and raw path strings as values.
 */
type OutputsObject<O extends readonly string[], Id extends string> = {
  [K in O[number]]: string;
};

/**
 * The outputs property type - either an object mapping output names to raw paths,
 * or undefined if no outputs are defined.
 */
type StepOutputsProperty<
  O extends readonly string[] | undefined,
  Id extends string,
> = O extends readonly string[] ? OutputsObject<O, Id> : undefined;

/**
 * Extended Step class that supports output declarations.
 * Wraps the base Step class and adds outputs tracking.
 *
 * When outputs are defined, the `outputs` property is an object mapping
 * output names to their raw path strings (e.g., `steps.{id}.outputs.{key}`).
 * Use `expressions.expn()` to wrap when needed.
 *
 * @example
 * ```ts
 * const step = new ExtendedStep({
 *   id: "docker_meta",
 *   uses: "docker/metadata-action@v5",
 *   outputs: ["version", "tags"],
 * });
 *
 * // step.outputs.version = "steps.docker_meta.outputs.version"
 * // step.outputs.tags = "steps.docker_meta.outputs.tags"
 *
 * // Use in conditions (interpolated directly):
 * if: `${step.outputs.version} != ''`
 *
 * // Use in expressions:
 * env: { VERSION: expressions.expn(step.outputs.version) }
 * ```
 */
export class ExtendedStep<
  const Id extends string = string,
  const Outputs extends readonly string[] | undefined = undefined,
> extends Step {
  declare readonly outputs: StepOutputsProperty<Outputs, Id>;
  declare readonly stepId: Id;

  constructor(
    stepProps: GeneratedWorkflowTypes.Step & { id: Id; outputs?: Outputs }
  ) {
    const { outputs: outputNames, ...stepConfig } = stepProps;
    super(stepConfig);

    // Build outputs object mapping names to raw path strings
    let outputsObject: Record<string, string> | undefined;
    if (outputNames && outputNames.length > 0) {
      outputsObject = {};
      for (const name of outputNames) {
        outputsObject[name] = `steps.${stepProps.id}.outputs.${name}`;
      }
    }

    // Define as non-enumerable to prevent serialization to YAML
    Object.defineProperty(this, "outputs", {
      value: outputsObject,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, "stepId", {
      value: stepProps.id,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}
