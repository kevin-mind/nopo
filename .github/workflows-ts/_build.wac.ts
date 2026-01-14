import {
  NormalJob,
  Step,
  Workflow,
  expressions,
} from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./lib/enhanced-step";
import { ExtendedNormalJob } from "./lib/enhanced-job";
import {
  buildPermissions,
  defaultDefaults,
  emptyPermissions,
} from "./lib/patterns";

// Build job
const buildJob = new ExtendedNormalJob("build", {
  "runs-on": "ubuntu-latest",
  permissions: buildPermissions,
  env: {
    build_output: "build-output.json",
  },
  steps: [
    new ExtendedStep({
      id: "checkout",
      uses: "actions/checkout@v4",
    }),
    new ExtendedStep({
      id: "setup_node",
      uses: "./.github/actions/setup-node",
    }),
    new ExtendedStep({
      id: "setup_nopo",
      uses: "./.github/actions/setup-nopo",
    }),
    new ExtendedStep({
      id: "docker_meta",
      name: "Docker meta",
      uses: "docker/metadata-action@v5",
      with: {
        "bake-target": "default",
        tags: "type=sha\n",
      },
      outputs: ["version"] as const,
    }),
    new ExtendedStep({
      id: "input_tag",
      name: "Input tag",
      uses: "./.github/actions-ts/docker-tag",
      with: {
        registry: "ghcr.io",
        image: expressions.expn("github.repository"),
        version: expressions.expn("steps.docker_meta.outputs.version"),
      },
      outputs: ["tag", "registry", "image", "version", "digest"] as const,
    }),
    new ExtendedStep({
      id: "docker",
      name: "Set up Docker",
      uses: "./.github/actions/setup-docker",
      with: {
        registry: expressions.expn("inputs.push && 'ghcr.io' || ''"),
        username: expressions.expn("inputs.push && github.actor || ''"),
        password: expressions.expn("inputs.push && secrets.GITHUB_TOKEN || ''"),
      },
      outputs: ["builder"] as const,
    }),
    new ExtendedStep({
      id: "build",
      name: "Build",
      env: {
        SERVICES: expressions.expn("inputs.services"),
        DOCKER_TAG: expressions.expn("steps.input_tag.outputs.tag"),
        DOCKER_PUSH: expressions.expn("inputs.push"),
        DOCKER_BUILDER: expressions.expn("steps.docker.outputs.builder"),
      },
      run: `if [[ -n "$SERVICES" ]]; then
  nopo build --output ${expressions.env("build_output")} $SERVICES
else
  nopo build --output ${expressions.env("build_output")}
fi`,
    }),
    new ExtendedStep({
      id: "build_info",
      name: "Extract build info",
      uses: "./.github/actions/extract-build-info",
      with: {
        build_output: expressions.env("build_output"),
      },
      outputs: ["base_digest", "service_tags", "service_digests"] as const,
    }),
    new ExtendedStep({
      id: "output_tag",
      name: "Output tag",
      uses: "./.github/actions-ts/docker-tag",
      with: {
        registry: expressions.expn("steps.input_tag.outputs.registry"),
        image: expressions.expn("steps.input_tag.outputs.image"),
        version: expressions.expn("steps.input_tag.outputs.version"),
        digest: expressions.expn(
          "inputs.push && steps.build_info.outputs.base_digest || ''"
        ),
      },
      outputs: ["tag", "registry", "image", "version", "digest"] as const,
    }),
  ] as const,
  outputs: (steps) => ({
    registry: steps.output_tag.outputs.registry,
    image: steps.output_tag.outputs.image,
    version: steps.output_tag.outputs.version,
    digest: steps.output_tag.outputs.digest,
    tag: steps.output_tag.outputs.tag,
    service_tags: steps.build_info.outputs.service_tags,
    service_digests: steps.build_info.outputs.service_digests,
  }),
});

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
          value: expressions.expn("jobs.build.outputs.registry"),
        },
        image: {
          description: "The image of the build",
          value: expressions.expn("jobs.build.outputs.image"),
        },
        version: {
          description: "The version of the build",
          value: expressions.expn("jobs.build.outputs.version"),
        },
        digest: {
          description: "The digest of the build",
          value: expressions.expn("jobs.build.outputs.digest"),
        },
        tag: {
          description: "The tag of the build",
          value: expressions.expn("jobs.build.outputs.tag"),
        },
        service_tags: {
          description: "JSON object mapping service names to their image tags",
          value: expressions.expn("jobs.build.outputs.service_tags"),
        },
        service_digests: {
          description: "JSON object mapping service names to their digests",
          value: expressions.expn("jobs.build.outputs.service_digests"),
        },
      },
    },
  },
  permissions: emptyPermissions,
  defaults: defaultDefaults,
});

buildWorkflow.addJobs([buildJob]);
