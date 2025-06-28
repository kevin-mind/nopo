import { Script } from "../lib.js";

export default class StatusScript extends Script {
  name = "status";
  description = "Check the status of the services";

  async fn() {
    this.runner.logger.log(
      Object.entries({
        platform: `${process.platform} ${process.arch}\n`,
        node: await this.exec`node --version`.text(),
        pnpm: await this.exec`pnpm --version`.text(),
      })
        .map(([key, value]) => `${key}: ${value}`)
        .join(""),
    );
  }
}
