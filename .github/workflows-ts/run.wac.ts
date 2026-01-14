import { NormalJob, Step, Workflow } from "@github-actions-workflow-ts/lib";
import { checkoutStep } from "./lib/steps";
import { defaultDefaults, emptyPermissions } from "./lib/patterns";

// Context job - resolves app name from fly configs
const contextJob = new NormalJob("context", {
  "runs-on": "ubuntu-latest",
  outputs: {
    app_name: "${{ steps.app.outputs.app_name }}",
    is_fork: "${{ steps.context.outputs.is_fork }}",
  },
});

contextJob.addSteps([
  checkoutStep,
  new Step({
    name: "Context",
    id: "context",
    uses: "./.github/actions/context",
  }),
  new Step({
    name: "App Names",
    id: "app_names",
    uses: "./.github/actions-ts/app-names",
    with: {
      environment: "${{ inputs.environment }}",
      app: "${{ inputs.app }}",
    },
  }),
  new Step({
    name: "App",
    id: "app",
    env: {
      app: "${{ inputs.app }}",
      environment: "${{ inputs.environment }}",
      app_names: "${{ steps.app_names.outputs.app_names }}",
    },
    run: `app_name=""
if [ $(echo "\${app_names}" | jq -r 'length') -eq 1 ]; then
  app_name=$(echo "\${app_names}" | jq -r '.[0]')
else
  echo "Error: Multiple app names \${app_names} found for \${app} in \${environment}"
  exit 1
fi

echo "app_name=\${app_name}" >> "$GITHUB_OUTPUT"
cat "$GITHUB_OUTPUT"
`,
  }),
]);

// Run job - executes command on Fly.io
const runJob = new NormalJob("run", {
  "runs-on": "ubuntu-latest",
  environment: "${{ inputs.environment }}",
});
runJob.needs([contextJob]);

runJob.addSteps([
  new Step({
    name: "Setup Flyctl",
    uses: "superfly/flyctl-actions/setup-flyctl@master",
  }),
  new Step({
    name: "Run",
    env: {
      FLY_API_TOKEN: "${{ secrets.FLY_API_TOKEN }}",
      app_name: "${{ needs.context.outputs.app_name }}",
      app: "${{ inputs.app }}",
      command: "${{ inputs.command }}",
      user: "nodeuser",
    },
    run: `make fly console \\
  app="\${app_name}" \\
  user="\${user}" \\
  command="pnpm run --filter=\\"@more/\${app}\\" \${command}"
`,
  }),
]);

// Main workflow
export const runWorkflow = new Workflow("run", {
  name: "Run",
  on: {
    workflow_dispatch: {
      inputs: {
        environment: {
          type: "choice" as const,
          description: "The environment to run the command on",
          required: true,
          options: ["stage", "prod"],
        },
        app: {
          type: "choice" as const,
          description: "The app to run the command on",
          required: true,
          options: ["backend", "web"],
        },
        command: {
          type: "string" as const,
          description: "The command to run",
          required: true,
        },
      },
    },
  },
  permissions: emptyPermissions,
  defaults: defaultDefaults,
});

runWorkflow.addJobs([contextJob, runJob]);
