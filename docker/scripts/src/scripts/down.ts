import compose from "docker-compose";
import { Script, createLogger } from "../lib.js";
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
    await compose.downAll({
      callback: createLogger("down", "yellow"),
      commandOptions: ["--rmi", "local", "--volumes"],
    });
  }
}
