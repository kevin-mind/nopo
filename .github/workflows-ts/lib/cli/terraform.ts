/**
 * Atomic step generators for Terraform CLI commands.
 *
 * Each function generates a Step that executes ONE terraform command.
 * For Terraform setup, use the hashicorp/setup-terraform action.
 */

import { Step, echoKeyValue, multilineString } from "@github-actions-workflow-ts/lib";

/**
 * terraform init - Initialize a working directory containing Terraform configuration files.
 */
export function terraformInit(
  opts: {
    workingDirectory: string;
    backendConfig?: Record<string, string>;
  },
  name?: string,
): Step {
  const backendArgs = opts.backendConfig
    ? Object.entries(opts.backendConfig)
        .map(([key, value]) => `-backend-config="${key}=${value}"`)
        .join(" \\\n  ")
    : "";

  return new Step({
    name: name ?? "terraform init",
    "working-directory": opts.workingDirectory,
    run: backendArgs
      ? `terraform init -input=false \\\n  ${backendArgs}`
      : "terraform init -input=false",
  });
}

/**
 * terraform plan - Generate an execution plan.
 */
export function terraformPlan(
  opts: {
    workingDirectory: string;
    outFile?: string;
  },
  name?: string,
): Step {
  const outArg = opts.outFile ? `-out=${opts.outFile}` : "";
  return new Step({
    name: name ?? "terraform plan",
    "working-directory": opts.workingDirectory,
    run: `terraform plan -input=false ${outArg}`.trim(),
  });
}

/**
 * terraform apply - Apply the changes required to reach the desired state.
 */
export function terraformApply(
  opts: {
    workingDirectory: string;
    autoApprove?: boolean;
    planFile?: string;
  },
  name?: string,
): Step {
  const args: string[] = ["-input=false"];
  if (opts.autoApprove) args.push("-auto-approve");
  if (opts.planFile) args.push(opts.planFile);

  return new Step({
    name: name ?? "terraform apply",
    "working-directory": opts.workingDirectory,
    run: `terraform apply ${args.join(" ")}`,
  });
}

/**
 * terraform output - Read an output variable from a Terraform state file.
 * Sets the output value to GITHUB_OUTPUT.
 */
export function terraformOutput(
  id: string,
  opts: {
    workingDirectory: string;
    outputName: string;
    outputKey?: string; // Key for GITHUB_OUTPUT, defaults to outputName
  },
  name?: string,
): Step {
  const outputKey = opts.outputKey ?? opts.outputName;
  return new Step({
    id,
    name: name ?? `terraform output ${opts.outputName}`,
    "working-directory": opts.workingDirectory,
    run: multilineString(
      `value=$(terraform output -raw ${opts.outputName})`,
      echoKeyValue.toGithubOutput(outputKey, "${value}"),
    ),
  });
}

/**
 * terraform destroy - Destroy Terraform-managed infrastructure.
 */
export function terraformDestroy(
  opts: {
    workingDirectory: string;
    autoApprove?: boolean;
  },
  name?: string,
): Step {
  const args: string[] = ["-input=false"];
  if (opts.autoApprove) args.push("-auto-approve");

  return new Step({
    name: name ?? "terraform destroy",
    "working-directory": opts.workingDirectory,
    run: `terraform destroy ${args.join(" ")}`,
  });
}

/**
 * terraform validate - Validates the configuration files in a directory.
 */
export function terraformValidate(
  opts: {
    workingDirectory: string;
  },
  name?: string,
): Step {
  return new Step({
    name: name ?? "terraform validate",
    "working-directory": opts.workingDirectory,
    run: "terraform validate",
  });
}

/**
 * terraform fmt - Rewrites config files to canonical format.
 */
export function terraformFmt(
  opts: {
    workingDirectory?: string;
    check?: boolean;
    recursive?: boolean;
  },
  name?: string,
): Step {
  const args: string[] = [];
  if (opts.check) args.push("-check");
  if (opts.recursive) args.push("-recursive");

  return new Step({
    name: name ?? "terraform fmt",
    ...(opts.workingDirectory && { "working-directory": opts.workingDirectory }),
    run: `terraform fmt ${args.join(" ")}`.trim(),
  });
}
