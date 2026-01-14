import { NormalJob, Step, Workflow } from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./lib/enhanced-step";
import { ExtendedNormalJob } from "./lib/enhanced-job";
import { defaultDefaults, readPermissions } from "./lib/patterns";

// Discover job
const discoverJob = new ExtendedNormalJob("discover", {
  "runs-on": "ubuntu-latest",
  steps: [
    new ExtendedStep({
      id: "checkout",
      uses: "actions/checkout@v4",
      with: {
        ref: "${{ inputs.ref }}",
        "fetch-depth": 0,
      },
    }),
    new ExtendedStep({
      id: "fetch_main",
      name: "Fetch origin/main for comparison",
      if: "inputs.since == 'origin/main' || inputs.since == ''",
      run: `# Ensure origin/main is available for comparison
git fetch origin main:origin/main || true
`,
    }),
    new ExtendedStep({
      id: "setup_node",
      uses: "./.github/actions/setup-node",
    }),
    new ExtendedStep({
      id: "discover",
      name: "Discover services",
      env: {
        FILTER: "${{ inputs.filter }}",
        SINCE: "${{ inputs.since }}",
      },
      run: `echo "=== Service Discovery ==="
echo "Filter: \${FILTER:-<none>}"
echo "Since: \${SINCE:-<none>}"
echo "Ref: \${GITHUB_REF:-main}"

# Build the command arguments
args="--json"
if [[ -n "\${FILTER}" ]]; then
  args="\${args} --filter \${FILTER}"
fi
if [[ -n "\${SINCE}" ]]; then
  args="\${args} --since \${SINCE}"
fi

echo "Command: make list -- \${args}"
echo ""

full_json=$(make list -- \${args})

# Extract service names from JSON
services_json=$(echo "\${full_json}" | jq -c '.services | keys')

# Validate JSON is valid array
if ! echo "\${services_json}" | jq -e '. | type == "array"' > /dev/null 2>&1; then
  echo "::error::Invalid services_json output: \${services_json}"
  exit 1
fi

services=$(echo "\${services_json}" | jq -r 'join(" ")')
count=$(echo "\${services_json}" | jq 'length')

# Ensure JSON is properly formatted (no newlines, proper escaping)
services_json_escaped=$(echo "\${services_json}" | jq -c '.')

echo "services=\${services}" >> "$GITHUB_OUTPUT"
echo "services_json=\${services_json_escaped}" >> "$GITHUB_OUTPUT"

echo "=== Result ==="
echo "Discovered \${count} service(s): \${services_json}"

if [[ "$count" == "0" ]]; then
  echo "::notice::No services matched the filter criteria"
fi
`,
      outputs: ["services", "services_json"] as const,
    }),
  ] as const,
  outputs: (steps) => ({
    services: steps.discover.outputs.services,
    services_json: steps.discover.outputs.services_json,
  }),
});

// Main workflow
export const servicesWorkflow = new Workflow("_services", {
  name: "Services",
  on: {
    workflow_call: {
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
      outputs: {
        services: {
          description:
            "Space-separated list of service names (for build targets)",
          value: "${{ jobs.discover.outputs.services }}",
        },
        services_json: {
          description: "JSON array of service names",
          value: "${{ jobs.discover.outputs.services_json }}",
        },
      },
    },
  },
  permissions: readPermissions,
  defaults: defaultDefaults,
});

servicesWorkflow.addJobs([discoverJob]);
