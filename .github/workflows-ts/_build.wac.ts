import { dedentString, expressions } from "@github-actions-workflow-ts/lib";
import { ExtendedStep } from "./lib/enhanced-step";
import { ExtendedNormalJob } from "./lib/enhanced-job";
import { ExtendedInputWorkflow } from "./lib/enhanced-workflow";
import {
  buildPermissions,
  defaultDefaults,
  emptyPermissions,
} from "./lib/patterns";
import { checkoutStep, setupNodeStep, setupNopoStep } from "./lib/steps";

export const buildWorkflow = new ExtendedInputWorkflow("_build", {
  name: "Build",
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
  permissions: emptyPermissions,
  defaults: defaultDefaults,
  jobs: (inputs) => ({
    build: new ExtendedNormalJob("build", {
      "runs-on": "ubuntu-latest",
      permissions: buildPermissions,
      env: {
        build_output: "build-output.json",
      },
      steps: () => {
        const dockerMetaStep = new ExtendedStep({
          id: "docker_meta",
          name: "Docker meta",
          uses: "docker/metadata-action@v5",
          with: {
            "bake-target": "default",
            tags: "type=sha\n",
          },
          outputs: ["version"],
        });

        const inputTagStep = new ExtendedStep({
          id: "input_tag",
          name: "Input tag",
          uses: "./.github/actions-ts/docker-tag",
          with: {
            registry: "ghcr.io",
            image: expressions.expn("github.repository"),
          },
          outputs: ["tag", "registry", "image", "version", "digest"],
        });

        const dockerStep = new ExtendedStep({
          id: "docker",
          name: "Set up Docker",
          uses: "./.github/actions/setup-docker",
          with: {
            registry: expressions.ternary(inputs.push, "ghcr.io", ""),
            username: expressions.ternary(inputs.push, expressions.expn("github.actor"), ""),
            password: expressions.ternary(inputs.push, expressions.secret("GITHUB_TOKEN"), ""),
          },
          outputs: ["builder"],
        });

        const buildInfoStep = new ExtendedStep({
          id: "build_info",
          name: "Extract build info",
          uses: "./.github/actions/extract-build-info",
          with: {
            build_output: expressions.env("build_output"),
          },
          outputs: ["base_digest", "service_tags", "service_digests"],
        });

        return [
          checkoutStep("checkout"),
          setupNodeStep("setup_node"),
          setupNopoStep("setup_nopo"),
          dockerMetaStep,
          inputTagStep,
          dockerStep,
          new ExtendedStep({
            id: "build",
            name: "Build",
            env: {
              SERVICES: inputs.services,
              DOCKER_TAG: expressions.expn(inputTagStep.outputs.tag),
              DOCKER_PUSH: inputs.push,
              DOCKER_BUILDER: expressions.expn(dockerStep.outputs.builder),
            },
            run: dedentString(`
              if [[ -n "$SERVICES" ]]; then
                nopo build --output ${expressions.env("build_output")} $SERVICES
              else
                nopo build --output ${expressions.env("build_output")}
              fi
            `),
          }),
          buildInfoStep,
          new ExtendedStep({
            id: "output_tag",
            name: "Output tag",
            uses: "./.github/actions-ts/docker-tag",
            with: {
              registry: expressions.expn(inputTagStep.outputs.registry),
              image: expressions.expn(inputTagStep.outputs.image),
              version: expressions.expn(inputTagStep.outputs.version),
              digest: expressions.expn(
                `inputs.push && ${buildInfoStep.outputs.base_digest} || ''`
              ),
            },
            outputs: ["tag", "registry", "image", "version", "digest"],
          }),
        ];
      },
      outputs: (steps) => ({
        registry: steps.output_tag.outputs.registry,
        image: steps.output_tag.outputs.image,
        version: steps.output_tag.outputs.version,
        digest: steps.output_tag.outputs.digest,
        tag: steps.output_tag.outputs.tag,
        service_tags: steps.build_info.outputs.service_tags,
        service_digests: steps.build_info.outputs.service_digests,
      }),
    }),
  }),
  outputs: (jobs) => ({
    registry: {
      description: "The registry of the build",
      value: jobs.build.outputs.registry,
    },
    image: {
      description: "The image of the build",
      value: jobs.build.outputs.image,
    },
    version: {
      description: "The version of the build",
      value: jobs.build.outputs.version,
    },
    digest: {
      description: "The digest of the build",
      value: jobs.build.outputs.digest,
    },
    tag: {
      description: "The tag of the build",
      value: jobs.build.outputs.tag,
    },
    service_tags: {
      description: "JSON object mapping service names to their image tags",
      value: jobs.build.outputs.service_tags,
    },
    service_digests: {
      description: "JSON object mapping service names to their digests",
      value: jobs.build.outputs.service_digests,
    },
  }),
});
