import { DockerCompose } from "../docker-compose.ts";
import { Script, createLogger } from "../lib.ts";
import EnvScript from "./env.ts";

export default class DownScript extends Script {
  static override dependencies = [
    {
      class: EnvScript,
      enabled: true,
    },
  ];
  static override name = "down";
  static override description = "Bring down the containers";

  override async fn() {
    const compose = new DockerCompose();
    await compose.down([], {
      callback: createLogger("down", "yellow"),
      commandOptions: ["--rmi=local", "--volumes"],
    });
  }
}
