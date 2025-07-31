import compose from "docker-compose";
import { Script } from "../lib.js";
import EnvScript from "./env.ts";

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

  override async fn() {
    const { data } = await compose.ps({
      cwd: this.runner.config.root,
    });

    const platform = `${process.platform} ${process.arch}`;
    const node = await this.exec`node --version`.text();
    const pnpm = await this.exec`pnpm --version`.text();

    this.log(
      JSON.stringify(
        {
          platform,
          node,
          pnpm,
          compose: data.services.reduce(
            (
              acc: Record<string, unknown>,
              { name, state, ports }: ServiceInfo,
            ) => ({
              ...acc,
              [name]: {
                name,
                state,
                ports,
              },
            }),
            {},
          ),
        },
        null,
        2,
      ),
    );
  }
}
