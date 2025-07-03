import compose from "docker-compose";

import { Script } from "../lib.js";

export default class StatusScript extends Script {
  name = "status";
  description = "Check the status of the services";

  async fn() {
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
            (acc, { name, state, ports }) => ({
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
