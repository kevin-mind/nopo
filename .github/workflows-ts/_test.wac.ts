import { dedentString, expressions, Workflow } from "@github-actions-workflow-ts/lib";
import { ExtendedNormalJob } from "./lib/enhanced-job";
import { ExtendedStep } from "./lib/enhanced-step";
import {
  defaultDefaults,
  emptyPermissions,
  testPermissions,
} from "./lib/patterns";
import { checkoutStep, setupNodeStep, setupUvStep } from "./lib/steps";

// Test job with matrix strategy
const testJob = new ExtendedNormalJob("test", {
  "runs-on": "ubuntu-latest",
  name: `[${expressions.expn("matrix.service || 'host'")}] ${expressions.expn("matrix.command")} (${expressions.expn("matrix.target")})`,
  strategy: {
    matrix: {
      service: expressions.expn("fromJson(inputs.services)"),
      command: ["test"],
      target: ["development", "production"],
      include: [
        {
          command: "check",
          target: "production",
        },
      ],
    },
    "fail-fast": false,
  },
  permissions: testPermissions,
  steps: [
    checkoutStep("checkout"),
    setupNodeStep("setup_node"),
    setupUvStep("setup_uv"),
    new ExtendedStep({
      id: "setup_docker",
      name: "Set up Docker",
      uses: "./.github/actions/setup-docker",
      with: {
        registry: "ghcr.io",
        username: expressions.expn("github.actor"),
        password: expressions.secret("GITHUB_TOKEN"),
      },
    }),
    new ExtendedStep({
      id: "docker_tag",
      name: "Docker Tag",
      uses: "./.github/actions-ts/docker-tag",
      with: {
        tag: expressions.expn("inputs.tag"),
      },
    }),
    new ExtendedStep({
      id: "run_command",
      name: `Run '${expressions.expn("matrix.command")}'`,
      uses: "./.github/actions-ts/run-docker",
      with: {
        tag: expressions.expn("steps.docker_tag.outputs.tag"),
        service: expressions.expn("matrix.service"),
        run: expressions.expn("matrix.command"),
        target: expressions.expn("matrix.target"),
      },
    }),
  ],
});

// Extendable job - tests that base image can be extended
const extendableJob = new ExtendedNormalJob("extendable", {
  "runs-on": "ubuntu-latest",
  permissions: testPermissions,
  steps: [
    checkoutStep("checkout"),
    setupNodeStep("setup_node"),
    setupUvStep("setup_uv"),
    new ExtendedStep({
      id: "setup_docker",
      uses: "./.github/actions/setup-docker",
      with: {
        registry: "ghcr.io",
        username: expressions.expn("github.actor"),
        password: expressions.secret("GITHUB_TOKEN"),
      },
    }),
    new ExtendedStep({
      id: "docker_tag",
      name: "Docker Tag",
      uses: "./.github/actions-ts/docker-tag",
      with: {
        tag: expressions.expn("inputs.tag"),
      },
    }),
    new ExtendedStep({
      id: "get_base_image",
      name: "Get base image",
      env: {
        DOCKER_TAG: expressions.expn("steps.docker_tag.outputs.tag"),
        DOCKER_DIGEST: expressions.expn("steps.docker_tag.outputs.digest"),
      },
      run: dedentString(`
        if [[ -n "$DOCKER_DIGEST" ]]; then
          echo "Digest present - pulling image from registry"
          docker pull "$DOCKER_TAG"
        else
          echo "No digest - building image locally"
          make build base \\
            DOCKER_TAG="$DOCKER_TAG" \\
            DOCKER_TARGET="development"
        fi
      `),
    }),
    new ExtendedStep({
      id: "verify_extendable",
      name: "Verify extendable base image",
      env: {
        DOCKER_TAG: expressions.expn("steps.docker_tag.outputs.tag"),
      },
      run: `./nopo/docker/tests/extendable.sh "${expressions.expn("steps.docker_tag.outputs.tag")}"`,
    }),
  ],
});

// Main workflow
export const testWorkflow = new Workflow("_test", {
  name: "Test",
  on: {
    workflow_call: {
      inputs: {
        tag: {
          description: "The full docker tag to test",
          required: true,
          type: "string",
        },
        services: {
          description: "JSON array of services to test",
          required: true,
          type: "string",
        },
      },
    },
  },
  permissions: emptyPermissions,
  defaults: defaultDefaults,
});

testWorkflow.addJobs([testJob, extendableJob]);