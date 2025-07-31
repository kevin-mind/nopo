import compose from "docker-compose";

import { Script, type ScriptDependency } from "../lib.ts";
import EnvScript from "./env.ts";

export default class DownScript extends Script {
  static override name = "down";
  static override description = "Stop the services";
  static override dependencies: ScriptDependency[] = [
    {
      class: EnvScript,
      enabled: true,
    },
  ];

  override async fn() {
    return await compose.downAll({
      log: true,
      commandOptions: ["--remove-orphans", "--rmi", "local"],
      env: this.env,
    });
  }
}
