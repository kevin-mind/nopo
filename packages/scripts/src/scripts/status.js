import { $ } from "zx";
import { Script } from "../lib.js";

export default class StatusScript extends Script {
  name = "status";
  description = "Check the status of the services";

  async fn() {
    console.log(
      Object.entries({
        platform: `${process.platform} ${process.arch}\n`,
        node: await $`node --version`.text(),
        pnpm: await $`pnpm --version`.text(),
      })
        .map(([key, value]) => `${key}: ${value}`)
        .join(""),
    );
  }
}
