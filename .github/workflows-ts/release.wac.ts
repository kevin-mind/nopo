import {
  dedentString,
  echoKeyValue,
  expressions,
  ReusableWorkflowCallJob,
  Workflow,
} from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./lib/enhanced-step";
import { ExtendedNormalJob, needs, needsOutput } from "./lib/enhanced-job";
import {
  buildPermissions,
  defaultDefaults,
  deployPermissions,
  emptyPermissions,
  readPermissions,
  testPermissions,
  versionPermissions,
} from "./lib/patterns";
import { ExtendedWorkflow } from "./lib/enhanced-workflow";
import { checkoutStep, checkStep, contextStep, setupNodeStep } from "./lib/steps";

// Context job - determines push/deploy settings
const contextJob = new ExtendedNormalJob("context", {
  "runs-on": "ubuntu-latest",
  permissions: readPermissions,
  steps: [
    checkoutStep("checkout", { fetchDepth: 0 }),
    setupNodeStep("setup_node"),
    // Note: context action outputs is_fork and default_branch, but
    // original code references event_name which doesn't exist
    contextStep("context", { outputs: ["event_name"] }),
    new ExtendedStep({
      id: "push_deploy",
      name: "Push / Deploy",
      env: {
        event_name: expressions.expn("github.event_name"),
        actor: expressions.expn("github.event.sender.login"),
        merge_actor: "github-merge-queue[bot]",
      },
      run: dedentString(`
        push=false
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
        ${echoKeyValue.toGithubOutput("push", "$push")}
        ${echoKeyValue.toGithubOutput("deploy", "$deploy")}
        cat "$GITHUB_OUTPUT"
      `),
      outputs: ["push", "deploy"],
    }),
  ],
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
const versionJob = new ExtendedNormalJob("version", {
  if: expressions.expn(`${needs(contextJob).outputs.event_name} == 'push'`),
  "runs-on": "ubuntu-latest",
  permissions: versionPermissions,
  needs: [contextJob],
  steps: [
    checkoutStep("checkout"),
    setupNodeStep("setup_node"),
    new ExtendedStep({
      id: "build",
      name: "Build",
      run: 'pnpm run --filter "./packages/*" build',
    }),
    new ExtendedStep({
      id: "publish_versions",
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
  ],
});

// Build job
const buildJob = new ReusableWorkflowCallJob("build", {
  permissions: buildPermissions,
  uses: "./.github/workflows/_build.yml",
  secrets: "inherit",
  with: {
    push: expressions.expn(`${needs(contextJob).outputs.push} == 'true'`),
    services: expressions.expn(needsOutput(discoverBuildableJob, "services")),
  },
  needs: [contextJob.name, discoverBuildableJob.name],
});

// Test job
const testJob = new ReusableWorkflowCallJob("test", {
  permissions: testPermissions,
  uses: "./.github/workflows/_test.yml",
  secrets: "inherit",
  with: {
    tag: expressions.expn(needsOutput(buildJob, "tag")),
    services: expressions.expn(needsOutput(discoverBuildableJob, "services_json")),
  },
  needs: [buildJob.name, contextJob.name, discoverBuildableJob.name],
});

// Deploy to staging job
const deployStageJob = new ReusableWorkflowCallJob("deploy_stage", {
  permissions: deployPermissions,
  uses: "./.github/workflows/_deploy_gcp.yml",
  secrets: "inherit",
  with: {
    environment: "stage",
    version: expressions.expn(needsOutput(buildJob, "version")),
    digest: expressions.expn(needsOutput(buildJob, "digest")),
    services: expressions.expn(needsOutput(discoverBuildableJob, "services_json")),
  },
  needs: [contextJob.name, buildJob.name, testJob.name, discoverBuildableJob.name],
});

// Deploy to production job
const deployProdJob = new ReusableWorkflowCallJob("deploy_prod", {
  permissions: deployPermissions,
  uses: "./.github/workflows/_deploy_gcp.yml",
  secrets: "inherit",
  with: {
    environment: "prod",
    version: expressions.expn(needsOutput(buildJob, "version")),
    digest: expressions.expn(needsOutput(buildJob, "digest")),
    services: expressions.expn(needsOutput(discoverBuildableJob, "services_json")),
  },
  needs: [contextJob.name, buildJob.name, deployStageJob.name, testJob.name, discoverBuildableJob.name],
});

// Main workflow
export const releaseWorkflow = new ExtendedWorkflow("release", {
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
  jobs: {
    context: contextJob,
    discover_buildable: discoverBuildableJob,
    version: versionJob,
    build: buildJob,
    test: testJob,
    deploy_stage: deployStageJob,
    deploy_prod: deployProdJob,
    // Checks job - aggregates all job results
    checks: new ExtendedNormalJob("checks", {
      if: "always()",
      "runs-on": "ubuntu-latest",
      needs: [buildJob, testJob, deployStageJob, deployProdJob],
      steps: [
        checkoutStep("checkout"),
        checkStep("check", expressions.expn("toJson(needs)")),
      ],
    }),
  }
});
