import {
  ReusableWorkflowCallJob,
  dedentString,
  expressions,
} from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./lib/enhanced-step";
import { ExtendedNormalJob, needs, needsOutput } from "./lib/enhanced-job";
import {
  buildPermissions,
  defaultDefaults,
  emptyPermissions,
  readPermissions,
  testPermissions,
} from "./lib/patterns";
import {
  checkoutStep,
  checkStep,
  contextStep,
  runDockerStep,
  setupDockerStep,
  setupNodeStep,
  smoketestStep,
} from "./lib/steps";
import { ExtendedWorkflow } from "./lib/enhanced-workflow";

// Context job - detects fork status and changed files
const contextJob = new ExtendedNormalJob("context", {
  "runs-on": "ubuntu-latest",
  permissions: readPermissions,
  steps: () => {
    const changedFilesStep = new ExtendedStep({
      id: "changed_files",
      name: "Get changed files",
      uses: "tj-actions/changed-files@ed68ef82c095e0d48ec87eccea555d944a631a4c",
      with: {
        files_yaml: dedentString(`
          github_actions:
            - .github/**
          backend_migrations:
            - apps/backend/src/*/migrations/**
          backend_source:
            - apps/backend/**
            - "!apps/backend/src/*/migrations/**"
        `),
      },
      outputs: ["changed_keys", "changed_files"],
    });
    return [
      checkoutStep("checkout"),
      contextStep("context", { outputs: ["is_fork", "default_branch"] }),
      changedFilesStep,
      new ExtendedStep({
        id: "debug",
        name: "Debug",
        run: dedentString(`
          cat <<INNEREOF
            ${expressions.expn(`toJson(steps.changed_files.outputs)`)}
          INNEREOF
        `),
      }),
      new ExtendedStep({
        id: "fail_check",
        name: "Fail if migrations and source changed",
        if: `contains(${changedFilesStep.outputs.changed_keys}, 'backend_migrations') && contains(${changedFilesStep.outputs.changed_keys}, 'backend_source')`,
        run: dedentString(`
          echo "Migrations and source files cannot be changed together"
          exit 1
        `),
      }),
    ];
  },
  outputs: (steps) => ({
    is_fork: steps.context.outputs.is_fork,
  }),
});

// Discover job - calls _services.yml reusable workflow
const discoverJob = new ReusableWorkflowCallJob("discover", {
  permissions: readPermissions,
  uses: "./.github/workflows/_services.yml",
  with: {
    filter: "changed",
    ref: expressions.expn("github.event.pull_request.head.sha || github.sha"),
  },
});

// Build job - calls _build.yml reusable workflow
const buildJob = new ReusableWorkflowCallJob("build", {
  needs: [contextJob.name, discoverJob.name],
  if: expressions.expn(`${needsOutput(discoverJob, "services")} != ''`),
  permissions: buildPermissions,
  uses: "./.github/workflows/_build.yml",
  secrets: "inherit",
  with: {
    push: expressions.expn(`${needs(contextJob).outputs.is_fork} == 'false'`),
    services: expressions.expn(needsOutput(discoverJob, "services")),
  },
});

// Test job - calls _test.yml reusable workflow
const testJob = new ReusableWorkflowCallJob("test", {
  if: expressions.expn(`needs.build.result == 'success' && ${needsOutput(discoverJob, "services_json")} != '[]'`),
  permissions: testPermissions,
  uses: "./.github/workflows/_test.yml",
  secrets: "inherit",
  with: {
    tag: expressions.expn(needsOutput(buildJob, "tag")),
    services: expressions.expn(needsOutput(discoverJob, "services_json")),
  },
  needs: [buildJob.name, contextJob.name, discoverJob.name],
});

// Test nopo job - calls _test_nopo.yml reusable workflow
const testNopoJob = new ReusableWorkflowCallJob("test_nopo", {
  permissions: readPermissions,
  uses: "./.github/workflows/_test_nopo.yml",
});

// Smoketest job - runs E2E tests
const smoketestJob = new ExtendedNormalJob("smoketest", {
  if: expressions.expn(`${needsOutput(discoverJob, "services")} != ''`),
  "runs-on": "ubuntu-latest",
  "timeout-minutes": 10,
  needs: [contextJob, discoverJob],
  steps: [
    checkoutStep("checkout"),
    setupNodeStep("setup_node"),
    setupDockerStep("setup_docker"),
    runDockerStep("up"),
    smoketestStep("smoketest", "http://localhost"),
  ],
});

// Terraform job - validates terraform configs
const terraformJob = new ExtendedNormalJob("terraform", {
  "runs-on": "ubuntu-latest",
  "timeout-minutes": 5,
  steps: [
    checkoutStep("checkout"),
    new ExtendedStep({
      id: "setup_terraform",
      name: "Setup Terraform",
      uses: "hashicorp/setup-terraform@v3",
      with: {
        terraform_version: "1.7.0",
      },
    }),
    new ExtendedStep({
      id: "lint_terraform",
      name: "Lint and Format Terraform",
      run: "make lint-terraform",
    }),
    new ExtendedStep({
      id: "check_uncommitted",
      name: "Check for uncommitted changes",
      run: "git diff --exit-code\n",
    }),
  ],
});

// Checks job - aggregates all job results
const checksJob = new ExtendedNormalJob("checks", {
  if: "always()",
  "runs-on": "ubuntu-latest",
  needs: [
    contextJob,
    discoverJob,
    buildJob,
    testJob,
    testNopoJob,
    smoketestJob,
    terraformJob,
  ],
  steps: [
    checkoutStep("checkout"),
    checkStep("check", expressions.expn("toJson(needs)")),
  ],
});

// Main workflow
export const ciWorkflow = new ExtendedWorkflow("ci", {
  name: "CI",
  on: {
    pull_request: {
      branches: ["main"],
    },
  },
  concurrency: {
    group: `${expressions.expn("github.workflow")}-${expressions.expn("github.event.pull_request.number")}`,
    "cancel-in-progress": true,
  },
  permissions: emptyPermissions,
  defaults: defaultDefaults,
  env: {
    CI: "true",
  },
  jobs: {
    context: contextJob,
    discover: discoverJob,
    build: buildJob,
    test: testJob,
    testNopo: testNopoJob,
    smoketest: smoketestJob,
    terraform: terraformJob,
    checks: checksJob,
  },
});

