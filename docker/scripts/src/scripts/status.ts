import compose from "docker-compose";
import { Script } from "../lib.js";
import EnvScript from "./env.ts";
import { isInContainer } from "../utils.ts";

interface ServiceInfo {
  name: string;
  state: string;
  ports: unknown;
}

export default class StatusScript extends Script {
  static override dependencies = [
    {
      class: EnvScript,
      enabled: true,
    },
  ];
  static override name = "status";
  static override description = "Check the status of the services";

  async compose() {
    if (isInContainer()) return {};

    const { data } = await compose.ps({
      cwd: this.runner.config.root,
    });

    data.services.reduce(
      (acc: Record<string, unknown>, { name, state, ports }: ServiceInfo) => ({
        ...acc,
        [name]: {
          name,
          state,
          ports,
        },
      }),
      {},
    );
  }

  override async fn(): Promise<void> {
    this.log(
      JSON.stringify(
        {
          platform: `${process.platform} ${process.arch}`,
          node: await this.exec`node --version`.text(),
          pnpm: await this.exec`pnpm --version`.text(),
          compose: await this.compose(),
        },
        null,
        2,
      ),
    );
  }
}
