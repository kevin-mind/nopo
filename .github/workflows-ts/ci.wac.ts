import {
  NormalJob,
  ReusableWorkflowCallJob,
  Step,
  Workflow,
} from "@github-actions-workflow-ts/lib";
import {
  checkoutStep,
  setupNodeStep,
  setupDockerStep,
  smoketestStep,
  checkStep,
} from "./lib/steps";
import {
  buildPermissions,
  defaultDefaults,
  emptyPermissions,
  readPermissions,
  testPermissions,
} from "./lib/patterns";

// Context job - detects fork status and changed files
const contextJob = new NormalJob("context", {
  "runs-on": "ubuntu-latest",
  permissions: readPermissions,
  outputs: {
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
    name: "Get changed files",
    id: "changed_files",
    uses: "tj-actions/changed-files@ed68ef82c095e0d48ec87eccea555d944a631a4c",
    with: {
      files_yaml: `github_actions:
  - .github/**
backend_migrations:
  - apps/backend/src/*/migrations/**
backend_source:
  - apps/backend/**
  - "!apps/backend/src/*/migrations/**"
`,
    },
  }),
  new Step({
    name: "Debug",
    run: `cat <<INNEREOF
\${{ toJson(steps.changed_files.outputs) }}
INNEREOF
`,
  }),
  new Step({
    name: "Fail if migrations and source changed",
    if: "contains(steps.changed_files.outputs.changed_keys, 'backend_migrations') && contains(steps.changed_files.outputs.changed_keys, 'backend_source')",
    run: `echo "Migrations and source files cannot be changed together"
exit 1
`,
  }),
]);

// Discover job - calls _services.yml reusable workflow
const discoverJob = new ReusableWorkflowCallJob("discover", {
  permissions: readPermissions,
  uses: "./.github/workflows/_services.yml",
  with: {
    filter: "changed",
    ref: "${{ github.event.pull_request.head.sha || github.sha }}",
  },
});

// Build job - calls _build.yml reusable workflow
const buildJob = new ReusableWorkflowCallJob("build", {
  if: "${{ needs.discover.outputs.services != '' }}",
  permissions: buildPermissions,
  uses: "./.github/workflows/_build.yml",
  secrets: "inherit",
  with: {
    push: "${{ needs.context.outputs.is_fork == 'false' }}",
    services: "${{ needs.discover.outputs.services }}",
  },
});
buildJob.needs([contextJob, discoverJob]);

// Test job - calls _test.yml reusable workflow
const testJob = new ReusableWorkflowCallJob("test", {
  if: "${{ needs.build.result == 'success' && needs.discover.outputs.services_json != '[]' }}",
  permissions: testPermissions,
  uses: "./.github/workflows/_test.yml",
  secrets: "inherit",
  with: {
    tag: "${{ needs.build.outputs.tag }}",
    services: "${{ needs.discover.outputs.services_json }}",
  },
});
testJob.needs([buildJob, contextJob, discoverJob]);

// Test nopo job - calls _test_nopo.yml reusable workflow
const testNopoJob = new ReusableWorkflowCallJob("test_nopo", {
  permissions: readPermissions,
  uses: "./.github/workflows/_test_nopo.yml",
});

// Smoketest job - runs E2E tests
const smoketestJob = new NormalJob("smoketest", {
  if: "${{ needs.discover.outputs.services != '' }}",
  "runs-on": "ubuntu-latest",
  "timeout-minutes": 10,
});
smoketestJob.needs([contextJob, discoverJob]);

smoketestJob.addSteps([
  checkoutStep,
  setupNodeStep,
  setupDockerStep(),
  new Step({
    name: "Up",
    uses: "./.github/actions-ts/run-docker",
  }),
  smoketestStep("http://localhost"),
]);

// Terraform job - validates terraform configs
const terraformJob = new NormalJob("terraform", {
  "runs-on": "ubuntu-latest",
  "timeout-minutes": 5,
});

terraformJob.addSteps([
  checkoutStep,
  new Step({
    name: "Setup Terraform",
    uses: "hashicorp/setup-terraform@v3",
    with: {
      terraform_version: "1.7.0",
    },
  }),
  new Step({
    name: "Lint and Format Terraform",
    run: "make lint-terraform",
  }),
  new Step({
    name: "Check for uncommitted changes",
    run: "git diff --exit-code\n",
  }),
]);

// Checks job - aggregates all job results
const checksJob = new NormalJob("checks", {
  if: "always()",
  "runs-on": "ubuntu-latest",
});
checksJob.needs([
  contextJob,
  discoverJob,
  buildJob,
  testJob,
  testNopoJob,
  smoketestJob,
  terraformJob,
]);

checksJob.addSteps([checkoutStep, checkStep("${{ toJson(needs) }}")]);

// Main workflow
export const ciWorkflow = new Workflow("ci", {
  name: "CI",
  on: {
    pull_request: {
      branches: ["main"],
    },
  },
  concurrency: {
    group: "${{ github.workflow }}-${{ github.event.pull_request.number }}",
    "cancel-in-progress": true,
  },
  permissions: emptyPermissions,
  defaults: defaultDefaults,
  env: {
    CI: "true",
  },
});

ciWorkflow.addJobs([
  contextJob,
  discoverJob,
  buildJob,
  testJob,
  testNopoJob,
  smoketestJob,
  terraformJob,
  checksJob,
]);
