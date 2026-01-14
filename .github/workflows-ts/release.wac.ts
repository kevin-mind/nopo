import {
  expressions,
  NormalJob,
  ReusableWorkflowCallJob,
  Step,
  Workflow,
} from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./lib/enhanced-step";
import { ExtendedNormalJob } from "./lib/enhanced-job";
import {
  checkoutStep,
  checkoutWithDepth,
  setupNodeStep,
  checkStep,
} from "./lib/steps";
import {
  buildPermissions,
  defaultDefaults,
  deployPermissions,
  emptyPermissions,
  readPermissions,
  testPermissions,
  versionPermissions,
} from "./lib/patterns";

// Context job - determines push/deploy settings
const contextJob = new ExtendedNormalJob("context", {
  "runs-on": "ubuntu-latest",
  permissions: readPermissions,
  steps: [
    new ExtendedStep({
      id: "checkout",
      uses: "actions/checkout@v4",
      with: { "fetch-depth": 0 },
    }),
    new ExtendedStep({
      id: "setup_node",
      uses: "./.github/actions/setup-node",
    }),
    new ExtendedStep({
      id: "context",
      name: "Context",
      uses: "./.github/actions/context",
      // Note: context action outputs is_fork and default_branch, but
      // original code references event_name which doesn't exist
      outputs: ["event_name"] as const,
    }),
    new ExtendedStep({
      id: "push_deploy",
      name: "Push / Deploy",
      env: {
        event_name: expressions.expn("github.event_name"),
        actor: expressions.expn("github.event.sender.login"),
        merge_actor: "github-merge-queue[bot]",
      },
      run: `push=false
deploy=false

# Push images on merge queue. This only runs on the target repo
# so no need to check if it is a fork.
if [[ "$event_name" == "merge_group" ]]; then
  push=true
  deploy=true
# Push images on push events that were not sent by the merge queue bot
# as merge queue commits are deployed before the PR is merged.
elif [[ "$event_name" == "push" && "$actor" != "$merge_actor" ]]; then
  push=true
  deploy=true
fi

echo "event_name=$event_name"
echo "push=$push" >> $GITHUB_OUTPUT
echo "deploy=$deploy" >> $GITHUB_OUTPUT
cat "$GITHUB_OUTPUT"
`,
      outputs: ["push", "deploy"] as const,
    }),
  ] as const,
  outputs: (steps) => ({
    event_name: steps.context.outputs.event_name,
    push: steps.push_deploy.outputs.push,
    deploy: steps.push_deploy.outputs.deploy,
  }),
});

// Discover buildable services job
const discoverBuildableJob = new ReusableWorkflowCallJob("discover_buildable", {
  permissions: readPermissions,
  uses: "./.github/workflows/_services.yml",
  with: {
    filter: "buildable",
    ref: expressions.expn("github.sha"),
  },
});

// Version job - runs changesets for semantic versioning
const versionJob = new NormalJob("version", {
  if: expressions.expn("needs.context.outputs.event_name == 'push'"),
  "runs-on": "ubuntu-latest",
  permissions: versionPermissions,
});
versionJob.needs([contextJob]);

versionJob.addSteps([
  checkoutStep,
  setupNodeStep,
  new Step({
    name: "Build",
    run: 'pnpm run --filter "./packages/*" build',
  }),
  new Step({
    name: "Create and publish versions",
    uses: "changesets/action@v1",
    with: {
      commit: "chore: update versions",
      title: "chore: update versions",
      publish: "pnpm publish:workspace",
    },
    env: {
      GITHUB_TOKEN: expressions.secret("GITHUB_TOKEN"),
      NPM_TOKEN: expressions.secret("NPM_TOKEN"),
    },
  }),
]);

// Build job
const buildJob = new ReusableWorkflowCallJob("build", {
  permissions: buildPermissions,
  uses: "./.github/workflows/_build.yml",
  secrets: "inherit",
  with: {
    push: expressions.expn("needs.context.outputs.push == 'true'"),
    services: expressions.expn("needs.discover_buildable.outputs.services"),
  },
});
buildJob.needs([contextJob, discoverBuildableJob]);

// Test job
const testJob = new ReusableWorkflowCallJob("test", {
  permissions: testPermissions,
  uses: "./.github/workflows/_test.yml",
  secrets: "inherit",
  with: {
    tag: expressions.expn("needs.build.outputs.tag"),
    services: expressions.expn("needs.discover_buildable.outputs.services_json"),
  },
});
testJob.needs([buildJob, contextJob, discoverBuildableJob]);

// Deploy to staging job
const deployStageJob = new ReusableWorkflowCallJob("deploy_stage", {
  permissions: deployPermissions,
  uses: "./.github/workflows/_deploy_gcp.yml",
  secrets: "inherit",
  with: {
    environment: "stage",
    version: expressions.expn("needs.build.outputs.version"),
    digest: expressions.expn("needs.build.outputs.digest"),
    services: expressions.expn("needs.discover_buildable.outputs.services_json"),
  },
});
deployStageJob.needs([contextJob, buildJob, testJob, discoverBuildableJob]);

// Deploy to production job
const deployProdJob = new ReusableWorkflowCallJob("deploy_prod", {
  permissions: deployPermissions,
  uses: "./.github/workflows/_deploy_gcp.yml",
  secrets: "inherit",
  with: {
    environment: "prod",
    version: expressions.expn("needs.build.outputs.version"),
    digest: expressions.expn("needs.build.outputs.digest"),
    services: expressions.expn("needs.discover_buildable.outputs.services_json"),
  },
});
deployProdJob.needs([
  contextJob,
  buildJob,
  deployStageJob,
  testJob,
  discoverBuildableJob,
]);

// Checks job - aggregates all job results
const checksJob = new NormalJob("checks", {
  if: "always()",
  "runs-on": "ubuntu-latest",
});
checksJob.needs([buildJob, testJob, deployStageJob, deployProdJob]);

checksJob.addSteps([checkoutStep, checkStep(expressions.expn("toJson(needs)"))]);

// Main workflow
export const releaseWorkflow = new Workflow("release", {
  name: "Release",
  on: {
    push: {
      branches: ["main"],
    },
    merge_group: {},
  },
  concurrency: {
    group: `${expressions.expn("github.workflow")}-${expressions.expn("(github.event_name == 'merge_group' || github.event_name == 'push' && github.event.sender.login != 'github-merge-queue[bot]') && 'push' || 'pr'")}`,
    "cancel-in-progress": true,
  },
  permissions: emptyPermissions,
  defaults: defaultDefaults,
  env: {
    CI: "true",
  },
});

releaseWorkflow.addJobs([
  contextJob,
  discoverBuildableJob,
  versionJob,
  buildJob,
  testJob,
  deployStageJob,
  deployProdJob,
  checksJob,
]);
