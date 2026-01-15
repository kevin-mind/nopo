import { ExtendedStep } from "./enhanced-step";

// Checkout step
export function checkoutStep<const Id extends string>(
  id: Id,
  opts?: {
    ref?: string;
    fetchDepth?: number;
    if?: string;
    name?: string;
  },
) {
  const withObj: Record<string, string | number> = {};
  if (opts?.ref) withObj.ref = opts.ref;
  if (opts?.fetchDepth !== undefined) withObj["fetch-depth"] = opts.fetchDepth;

  return new ExtendedStep({
    id,
    ...(opts?.name && { name: opts.name }),
    ...(opts?.if && { if: opts.if }),
    uses: "actions/checkout@v4",
    ...(Object.keys(withObj).length > 0 && { with: withObj }),
  });
}

// Setup steps
export function setupNodeStep<const Id extends string>(id: Id) {
  return new ExtendedStep({
    id,
    uses: "./.github/actions/setup-node",
  });
}

export function setupUvStep<const Id extends string>(id: Id) {
  return new ExtendedStep({
    id,
    uses: "./.github/actions/setup-uv",
  });
}

export function setupNopoStep<const Id extends string>(id: Id) {
  return new ExtendedStep({
    id,
    uses: "./.github/actions/setup-nopo",
  });
}

export function setupDockerStep<const Id extends string>(
  id: Id,
  opts?: {
    registry?: string;
    username?: string;
    password?: string;
  },
) {
  return new ExtendedStep({
    id,
    uses: "./.github/actions/setup-docker",
    ...(opts && { with: opts }),
  });
}

// Context action
export function contextStep<
  const Id extends string,
  const Outputs extends readonly string[] | undefined = undefined,
>(
  id: Id,
  opts?: {
    outputs?: Outputs;
  },
) {
  return new ExtendedStep<Id, Outputs>({
    id,
    name: "Context",
    uses: "./.github/actions/context",
    ...(opts?.outputs && { outputs: opts.outputs }),
  });
}

// Docker tag action (TypeScript)
export function dockerTagStep<const Id extends string>(
  id: Id,
  opts: {
    tag?: string;
    registry?: string;
    image?: string;
    version?: string;
    digest?: string;
  },
  name?: string,
) {
  return new ExtendedStep({
    id,
    name: name ?? "Docker Tag",
    uses: "./.github/actions-ts/docker-tag",
    with: opts,
  });
}

// Run docker action (TypeScript)
export function runDockerStep<const Id extends string>(
  id: Id,
  opts?: {
    tag?: string;
    service?: string;
    run?: string;
    target?: string;
  },
) {
  return new ExtendedStep({
    id,
    uses: "./.github/actions-ts/run-docker",
    ...(opts && { with: opts }),
  });
}

// Check action (for final status checks)
export function checkStep<const Id extends string>(id: Id, json: string) {
  return new ExtendedStep({
    id,
    name: "Check",
    uses: "./.github/actions/check",
    with: { json },
  });
}

// Smoketest action
export function smoketestStep<const Id extends string>(
  id: Id,
  publicUrl: string,
  opts?: { name?: string; canary?: boolean },
) {
  const withInput: Record<string, string | boolean> = { public_url: publicUrl };
  if (opts?.name) withInput.name = opts.name;
  if (opts?.canary !== undefined) withInput.canary = opts.canary;
  return new ExtendedStep({
    id,
    name: "Run smoketest",
    uses: "./.github/actions/smoketest",
    with: withInput,
  });
}

// Extract build info action
export function extractBuildInfoStep<const Id extends string>(
  id: Id,
  opts: {
    build_output: string;
  },
  name?: string,
) {
  return new ExtendedStep({
    id,
    name: name ?? "Extract build info",
    uses: "./.github/actions/extract-build-info",
    with: opts,
  });
}

// Validate services action
export function validateServicesStep<const Id extends string>(
  id: Id,
  opts: {
    services: string;
  },
  name?: string,
) {
  return new ExtendedStep({
    id,
    name: name ?? "Validate services",
    uses: "./.github/actions/validate-services",
    with: opts,
  });
}

// PR view extended action (TypeScript)
// Outputs: has_pr, is_claude_pr, is_draft, pr_number, pr_head_branch, pr_body, has_issue, issue_number
export function prViewExtendedStep<const Id extends string>(
  id: Id,
  opts: {
    gh_token: string;
    head_branch?: string;
    pr_number?: string;
    repository?: string;
  },
  name?: string,
) {
  return new ExtendedStep({
    id,
    name: name ?? "PR view (extended)",
    uses: "./.github/actions-ts/pr-view-extended",
    with: opts,
    outputs: [
      "has_pr",
      "is_claude_pr",
      "is_draft",
      "pr_number",
      "pr_head_branch",
      "pr_body",
      "has_issue",
      "issue_number",
    ] as const,
  });
}
