import compose from "docker-compose";
import { Script } from "../lib.ts";
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
  static override description = "Check the status of the project and services";

  override async fn() {
    const { data } = await compose.ps({
      cwd: this.runner.config.root,
    });

    const platform = `${process.platform} ${process.arch}`;
    const node = await this.exec`node --version`.text();
    const pnpm = await this.exec`pnpm --version`.text();

    const project = this.runner.config.project;

    this.log(
      JSON.stringify(
        {
          project: {
            name: project.name,
            configPath: project.configPath,
            servicesDirs: project.services.dirs,
            serviceCount: project.services.targets.length,
          },
          os: {
            base: project.os.base.from,
            user: project.os.user,
          },
          system: {
            platform,
            node: node.trim(),
            pnpm: pnpm.trim(),
          },
          containers: data.services.reduce(
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
