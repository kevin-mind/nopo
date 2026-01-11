import compose from "docker-compose";
import {
  TargetScript,
  type ScriptDependency,
  type Runner,
  createLogger,
} from "../lib.ts";
import EnvScript from "./env.ts";
import { parseTargetArgs } from "../target-args.ts";

type PullCliArgs = {
  targets: string[];
};

export default class PullScript extends TargetScript<PullCliArgs> {
  static override name = "pull";
  static override description = "Pull the base image";
  static override dependencies: ScriptDependency[] = [
    {
      class: EnvScript,
      enabled: true,
    },
  ];

  static override parseArgs(
    runner: Runner,
    isDependency: boolean,
  ): PullCliArgs {
    // When run as dependency for container execution, infer service targets from argv
    // This happens when CommandScript needs to pull images before running in container
    if (isDependency || runner.argv[0] !== "pull") {
      // Try to infer service targets from the command being run
      // e.g., "test backend" should pull backend image
      const inferredTargets = runner.argv.slice(1).filter((arg) => {
        // Filter out flags and options
        return (
          !arg.startsWith("--") &&
          !arg.startsWith("-") &&
          runner.config.targets.includes(arg)
        );
      });
      return { targets: inferredTargets };
    }

    const argv = runner.argv.slice(1);
    const parsed = parseTargetArgs("pull", argv, runner.config.targets, {
      supportsFilter: true,
      services: runner.config.project.services.entries,
      projectRoot: runner.config.root,
    });
    return { targets: parsed.targets };
  }

  override async fn(args: PullCliArgs) {
    const requestedTargets = args.targets;

    if (requestedTargets.length > 0) {
      // Pull specific target images from main compose file
      await compose.pullMany(requestedTargets, {
        callback: createLogger("pull", "blue"),
        commandOptions: ["--ignore-pull-failures"],
        env: this.env,
      });
    } else {
      // Default: pull base image
      this.log(`Pulling image: ${this.runner.environment.env.DOCKER_TAG}`);
      await this
        .exec`docker compose -f nopo/docker/docker-compose.base.yml pull base --policy always`;
    }
  }
}
