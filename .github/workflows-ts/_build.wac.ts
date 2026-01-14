import { NormalJob, Step, Workflow } from "@github-actions-workflow-ts/lib";
import {
  checkoutStep,
  setupNodeStep,
  dockerTagStep,
  extractBuildInfoStep,
} from "./lib/steps";
import { nopoBuild } from "./lib/cli/nopo";
import {
  buildPermissions,
  defaultDefaults,
  emptyPermissions,
} from "./lib/patterns";

// Build job
const buildJob = new NormalJob("build", {
  "runs-on": "ubuntu-latest",
  permissions: buildPermissions,
  outputs: {
    registry: "${{ steps.output_tag.outputs.registry }}",
    image: "${{ steps.output_tag.outputs.image }}",
    version: "${{ steps.output_tag.outputs.version }}",
    digest: "${{ steps.output_tag.outputs.digest }}",
    tag: "${{ steps.output_tag.outputs.tag }}",
    service_tags: "${{ steps.build_info.outputs.service_tags }}",
    service_digests: "${{ steps.build_info.outputs.service_digests }}",
  },
  env: {
    build_output: "build-output.json",
  },
});

buildJob.addSteps([
  checkoutStep,
  setupNodeStep,
  new Step({
    name: "Docker meta",
    id: "docker_meta",
    uses: "docker/metadata-action@v5",
    with: {
      "bake-target": "default",
      tags: "type=sha\n",
    },
  }),
  dockerTagStep(
    "input_tag",
    {
      registry: "ghcr.io",
      image: "${{ github.repository }}",
      version: "${{ steps.docker_meta.outputs.version }}",
    },
    "Input tag",
  ),
  new Step({
    name: "Set up Docker",
    id: "docker",
    uses: "./.github/actions/setup-docker",
    with: {
      registry: "${{ inputs.push && 'ghcr.io' || '' }}",
      username: "${{ inputs.push && github.actor || '' }}",
      password: "${{ inputs.push && secrets.GITHUB_TOKEN || '' }}",
    },
  }),
  nopoBuild(
    {
      SERVICES: "${{ inputs.services }}",
      DOCKER_TAG: "${{ steps.input_tag.outputs.tag }}",
      DOCKER_PUSH: "${{ inputs.push }}",
      DOCKER_BUILDER: "${{ steps.docker.outputs.builder }}",
    },
    { output: "${{ env.build_output }}" },
    "Build",
  ),
  extractBuildInfoStep("build_info", {
    build_output: "${{ env.build_output }}",
  }),
  dockerTagStep(
    "output_tag",
    {
      registry: "${{ steps.input_tag.outputs.registry }}",
      image: "${{ steps.input_tag.outputs.image }}",
      version: "${{ steps.input_tag.outputs.version }}",
      digest:
        "${{ inputs.push && steps.build_info.outputs.base_digest || '' }}",
    },
    "Output tag",
  ),
]);

// Main workflow
export const buildWorkflow = new Workflow("_build", {
  name: "Build",
  on: {
    workflow_call: {
      inputs: {
        push: {
          description: "Whether to push the image",
          required: true,
          type: "boolean",
        },
        services: {
          description:
            "Space-separated list of services to build (empty = all buildable services)",
          required: false,
          type: "string",
          default: "",
        },
      },
      outputs: {
        registry: {
          description: "The registry of the build",
          value: "${{ jobs.build.outputs.registry }}",
        },
        image: {
          description: "The image of the build",
          value: "${{ jobs.build.outputs.image }}",
        },
        version: {
          description: "The version of the build",
          value: "${{ jobs.build.outputs.version }}",
        },
        digest: {
          description: "The digest of the build",
          value: "${{ jobs.build.outputs.digest }}",
        },
        tag: {
          description: "The tag of the build",
          value: "${{ jobs.build.outputs.tag }}",
        },
        service_tags: {
          description: "JSON object mapping service names to their image tags",
          value: "${{ jobs.build.outputs.service_tags }}",
        },
        service_digests: {
          description: "JSON object mapping service names to their digests",
          value: "${{ jobs.build.outputs.service_digests }}",
        },
      },
    },
  },
  permissions: emptyPermissions,
  defaults: defaultDefaults,
});

buildWorkflow.addJobs([buildJob]);
