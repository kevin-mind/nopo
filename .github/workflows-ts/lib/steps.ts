import { Step } from "@github-actions-workflow-ts/lib";

// Checkout step (simple, no outputs)
export const checkoutStep = new Step({
  uses: "actions/checkout@v4",
});

export const checkoutWithRef = (ref: string) =>
  new Step({
    uses: "actions/checkout@v4",
    with: { ref },
  });

export const checkoutWithDepth = (fetchDepth: number, ref?: string) =>
  new Step({
    uses: "actions/checkout@v4",
    with: {
      ...(ref && { ref }),
      "fetch-depth": fetchDepth,
    },
  });

// Setup steps
export const setupNodeStep = new Step({
  uses: "./.github/actions/setup-node",
});

export const setupUvStep = new Step({
  uses: "./.github/actions/setup-uv",
});

export const setupNopoStep = new Step({
  uses: "./.github/actions/setup-nopo",
});

export const setupDockerStep = (opts?: {
  registry?: string;
  username?: string;
  password?: string;
}) =>
  new Step({
    uses: "./.github/actions/setup-docker",
    ...(opts && { with: opts }),
  });

// Context action
export const contextStep = (id: string) =>
  new Step({
    name: "Context",
    id,
    uses: "./.github/actions/context",
  });

// Docker tag action (TypeScript)
export const dockerTagStep = (
  id: string,
  opts: {
    tag?: string;
    registry?: string;
    image?: string;
    version?: string;
    digest?: string;
  },
  name?: string,
) =>
  new Step({
    name: name ?? "Docker Tag",
    id,
    uses: "./.github/actions-ts/docker-tag",
    with: opts,
  });

// Run docker action (TypeScript)
export const runDockerStep = (opts?: {
  tag?: string;
  service?: string;
  run?: string;
  target?: string;
}) =>
  new Step({
    uses: "./.github/actions-ts/run-docker",
    ...(opts && { with: opts }),
  });

// Check action (for final status checks)
export const checkStep = (json: string) =>
  new Step({
    name: "Check",
    uses: "./.github/actions/check",
    with: { json },
  });

// Smoketest action
export const smoketestStep = (
  publicUrl: string,
  opts?: { name?: string; canary?: boolean },
) => {
  const withInput: Record<string, string | boolean> = { public_url: publicUrl };
  if (opts?.name) withInput.name = opts.name;
  if (opts?.canary !== undefined) withInput.canary = opts.canary;
  return new Step({
    name: "Run smoketest",
    uses: "./.github/actions/smoketest",
    with: withInput,
  });
};

// Extract build info action
export const extractBuildInfoStep = (
  id: string,
  opts: {
    build_output: string;
  },
  name?: string,
) =>
  new Step({
    name: name ?? "Extract build info",
    id,
    uses: "./.github/actions/extract-build-info",
    with: opts,
  });

// Validate services action
export const validateServicesStep = (
  id: string,
  opts: {
    services: string;
  },
  name?: string,
) =>
  new Step({
    name: name ?? "Validate services",
    id,
    uses: "./.github/actions/validate-services",
    with: opts,
  });
