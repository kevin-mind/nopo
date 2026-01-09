import compose from "docker-compose";
import { TargetScript, type Runner, createLogger } from "../lib.ts";
import EnvScript from "./env.ts";
import { parseTargetArgs } from "../target-args.ts";

type DownCliArgs = {
  targets: string[];
};

export default class DownScript extends TargetScript<DownCliArgs> {
  static override dependencies = [
    {
      class: EnvScript,
      enabled: true,
    },
  ];
  static override name = "down";
  static override description = "Bring down the containers";

  static override parseArgs(
    runner: Runner,
    isDependency: boolean,
  ): DownCliArgs {
    // When run as dependency, return empty targets (all targets)
    if (isDependency || runner.argv[0] !== "down") {
      return { targets: [] };
    }

    const argv = runner.argv.slice(1);
    const parsed = parseTargetArgs("down", argv, runner.config.targets, {
      supportsFilter: true,
      services: runner.config.project.services.entries,
      projectRoot: runner.config.root,
    });
    return { targets: parsed.targets };
  }

  override async fn(args: DownCliArgs) {
    const requestedTargets = args.targets;

    if (requestedTargets.length > 0) {
      await compose.downMany(requestedTargets, {
        callback: createLogger("down", "yellow"),
        commandOptions: ["--rmi", "local", "--volumes"],
      });
    } else {
      await compose.downAll({
        callback: createLogger("down", "yellow"),
        commandOptions: ["--rmi", "local", "--volumes"],
      });
    }
  }
}
