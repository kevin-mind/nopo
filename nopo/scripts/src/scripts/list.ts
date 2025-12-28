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

      if (args.withConfig) {
        await this.printConfigTable(services);
      } else {
        this.runner.logger.log(`Discovered ${services.length} service(s):`);
        for (const service of services) {
          this.runner.logger.log(`  - ${service}`);
        }
      }
    }
  }

  private async printConfigTable(services: string[]) {
    const { chalk } = this.runner.logger;
    const configs = await this.getServicesWithConfig(services);

    // Define columns
    const columns = [
      { key: "service", header: "SERVICE", width: 12 },
      { key: "cpu", header: "CPU", width: 5 },
      { key: "memory", header: "MEMORY", width: 8 },
      { key: "port", header: "PORT", width: 6 },
      { key: "min", header: "MIN", width: 5 },
      { key: "max", header: "MAX", width: 5 },
      { key: "database", header: "DB", width: 5 },
      { key: "migrations", header: "MIGRATE", width: 8 },
    ];

    // Calculate column widths based on content
    for (const service of services) {
      const config = configs[service];
      columns[0].width = Math.max(columns[0].width, service.length);
      columns[1].width = Math.max(columns[1].width, config.cpu.length);
      columns[2].width = Math.max(columns[2].width, config.memory.length);
    }

    // Print header
    const headerRow = columns
      .map((col) => col.header.padEnd(col.width))
      .join("  ");
    this.runner.logger.log(chalk.cyan(chalk.bold(headerRow)));

    // Print separator
    const separator = columns.map((col) => "-".repeat(col.width)).join("  ");
    this.runner.logger.log(chalk.gray(separator));

    // Print rows
    for (const service of services) {
      const config = configs[service];
      const row = [
        chalk.yellow(service.padEnd(columns[0].width)),
        config.cpu.padEnd(columns[1].width),
        config.memory.padEnd(columns[2].width),
        String(config.port).padEnd(columns[3].width),
        String(config.min_instances).padEnd(columns[4].width),
        String(config.max_instances).padEnd(columns[5].width),
        (config.has_database ? chalk.green("yes") : chalk.gray("no")).padEnd(
          columns[6].width + 9,
        ), // +9 for color codes
        (config.run_migrations ? chalk.green("yes") : chalk.gray("no")).padEnd(
          columns[7].width + 9,
        ),
      ];
      this.runner.logger.log(row.join("  "));
    }

    this.runner.logger.log("");
    this.runner.logger.log(
      chalk.gray(`Total: ${services.length} service(s)`),
    );
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
