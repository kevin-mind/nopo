import { Script, type Runner } from "../lib.ts";
import process from "node:process";

type ListCliArgs = {
  format: "text" | "json" | "csv";
  withConfig: boolean;
};

export default class ListScript extends Script<ListCliArgs> {
  static override name = "list";
  static override description = "List discovered services";

  static override parseArgs(runner: Runner, isDependency: boolean): ListCliArgs {
    if (isDependency || runner.argv[0] !== "list") {
      return { format: "text", withConfig: false };
    }

    const argv = runner.argv.slice(1);
    let format: "text" | "json" | "csv" = "text";
    let withConfig = false;

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--format" || arg === "-f") {
        const formatArg = argv[i + 1];
        if (formatArg === "json") {
          format = "json";
        } else if (formatArg === "csv") {
          format = "csv";
        } else if (formatArg === "text") {
          format = "text";
        }
        i++;
      } else if (arg === "--json" || arg === "-j") {
        format = "json";
      } else if (arg === "--csv") {
        format = "csv";
      } else if (arg === "--with-config" || arg === "-c") {
        withConfig = true;
      }
    }

    return { format, withConfig };
  }

  override async fn(args: ListCliArgs) {
    const services = this.runner.config.targets;

    if (args.format === "json") {
      if (args.withConfig) {
        const servicesWithConfig = await this.getServicesWithConfig(services);
        process.stdout.write(JSON.stringify(servicesWithConfig, null, 2) + "\n");
      } else {
        process.stdout.write(JSON.stringify(services) + "\n");
      }
    } else if (args.format === "csv") {
      process.stdout.write(services.join(",") + "\n");
    } else {
      if (services.length === 0) {
        this.runner.logger.log("No services found.");
        return;
      }

      this.runner.logger.log(`Discovered ${services.length} service(s):`);
      for (const service of services) {
        this.runner.logger.log(`  - ${service}`);
      }
    }
  }

  private async getServicesWithConfig(
    services: string[],
  ): Promise<Record<string, ServiceConfig>> {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const result: Record<string, ServiceConfig> = {};

    for (const service of services) {
      const configPath = path.join(
        this.runner.config.root,
        "apps",
        service,
        "infrastructure.json",
      );

      let config: Partial<ServiceConfig> = {};
      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, "utf-8");
          config = JSON.parse(content);
        } catch {
          // Ignore parse errors, use defaults
        }
      }

      result[service] = {
        cpu: config.cpu ?? "1",
        memory: config.memory ?? "512Mi",
        port: config.port ?? 3000,
        min_instances: config.min_instances ?? 0,
        max_instances: config.max_instances ?? 10,
        has_database: config.has_database ?? false,
        run_migrations: config.run_migrations ?? false,
      };
    }

    return result;
  }
}

interface ServiceConfig {
  cpu: string;
  memory: string;
  port: number;
  min_instances: number;
  max_instances: number;
  has_database: boolean;
  run_migrations: boolean;
}
