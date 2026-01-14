import { Step, type GeneratedWorkflowTypes } from "@github-actions-workflow-ts/lib";

/**
 * Extended Step class that supports output declarations.
 * Wraps the base Step class and adds outputs tracking.
 * The outputs and id types are preserved to enable literal type inference.
 *
 * The `id` property is required and should be a string literal for best type inference.
 * The literal type is stored in `stepId` for type inference purposes.
 *
 * Note: `outputs` and `stepId` are non-enumerable to prevent serialization to YAML.
 */
export class ExtendedStep<
  const Id extends string = string,
  const Outputs extends readonly string[] | undefined = readonly string[] | undefined,
> extends Step {
  declare readonly outputs: Outputs | undefined;
  declare readonly stepId: Id;

  constructor(
    stepProps: GeneratedWorkflowTypes.Step & { id: Id; outputs?: Outputs }
  ) {
    const { outputs, ...stepConfig } = stepProps;
    super(stepConfig);
    // Define as non-enumerable to prevent serialization to YAML
    Object.defineProperty(this, 'outputs', {
      value: outputs,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(this, 'stepId', {
      value: stepProps.id,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
}

