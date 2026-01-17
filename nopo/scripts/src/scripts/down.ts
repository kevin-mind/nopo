import compose from "docker-compose";
import { TargetScript, type ScriptDependency, createLogger } from "../lib.ts";
import EnvScript from "./env.ts";
import { baseArgs } from "../args.ts";
import type { ScriptArgs } from "../script-args.ts";

export default class DownScript extends TargetScript {
  static override name = "down";
  static override description = "Bring down the containers";
  static override dependencies: ScriptDependency[] = [
    {
      class: EnvScript,
      enabled: true,
    },
  ];

  static override args = baseArgs.extend({});

  override async fn(args: ScriptArgs) {
    const requestedTargets = args.get<string[]>("targets") ?? [];

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
