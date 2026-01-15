import { expressions, dedentString } from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./lib/enhanced-step";
import { ExtendedNormalJob } from "./lib/enhanced-job";
import { ExtendedInputWorkflow } from "./lib/enhanced-workflow";
import { defaultDefaults, readPermissions } from "./lib/patterns";
import { checkoutStep, setupNodeStep } from "./lib/steps";

// Main workflow
export const servicesWorkflow = new ExtendedInputWorkflow("_services", {
  name: "Services",
  inputs: {
    filter: {
      description:
        'Filter expression passed to nopo list (e.g., "buildable", "changed", "!image")',
      required: false,
      type: "string",
      default: "",
    },
    since: {
      description: 'Git ref to compare against for "changed" filter',
      required: false,
      type: "string",
      default: "origin/main",
    },
    ref: {
      description: "Git ref to checkout (defaults to main)",
      required: false,
      type: "string",
      default: "",
    },
  },
  jobs: (inputs) => ({
    discover: new ExtendedNormalJob("discover", {
      "runs-on": "ubuntu-latest",
      steps: [
        checkoutStep("checkout", {
          ref: expressions.expn("inputs.ref"),
          fetchDepth: 0,
        }),
        new ExtendedStep({
          id: "fetch_main",
          name: "Fetch origin/main for comparison",
          if: expressions.expn(`${inputs.since} == 'origin/main' || ${inputs.since} == ''`),
          run: dedentString(`
            # Ensure origin/main is available for comparison
            git fetch origin main:origin/main || true
          `),
        }),
        setupNodeStep("setup_node"),
        new ExtendedStep({
          id: "discover",
          name: "Discover services",
          uses: "./.github/actions-ts/discover-services",
          with: {
            filter: expressions.expn("inputs.filter"),
            since: expressions.expn("inputs.since"),
          },
          outputs: ["services", "services_json"],
        }),
      ],
      outputs: (steps) => ({
        services: steps.discover.outputs.services,
        services_json: steps.discover.outputs.services_json,
      }),
    }),
  }),
  outputs: (jobs) => ({
    services: { value: jobs.discover.outputs.services },
    services_json: { value: jobs.discover.outputs.services_json },
  }),
  permissions: readPermissions,
  defaults: defaultDefaults,
});

