import { Script, type Runner } from "../lib.ts";
import process from "node:process";

type ListCliArgs = {
  format: "text" | "json" | "csv";
  withConfig: boolean;
};

export default class ListScript extends Script<ListCliArgs> {
  static override name = "list";
  static override description = "List discovered services";

  static override parseArgs(
    runner: Runner,
    isDependency: boolean,
  ): ListCliArgs {
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
    const services = args.withConfig
      ? this.runner.config.project.services.order
      : this.runner.config.targets;

    if (args.format === "json") {
      if (args.withConfig) {
        const servicesWithConfig = this.getServicesWithConfig(services);
        process.stdout.write(
          JSON.stringify(servicesWithConfig, null, 2) + "\n",
        );
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
    const configs = this.getServicesWithConfig(services);

    // Define columns
    const columns = [
      { key: "service", header: "SERVICE", width: 12 },
      { key: "kind", header: "KIND", width: 8 },
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
      const config = configs[service]!;
      columns[0]!.width = Math.max(columns[0]!.width, service.length);
      columns[1]!.width = Math.max(columns[1]!.width, config.kind.length);
      columns[2]!.width = Math.max(columns[2]!.width, config.cpu.length);
      columns[3]!.width = Math.max(columns[3]!.width, config.memory.length);
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
      const config = configs[service]!;
      const row = [
        chalk.yellow(service.padEnd(columns[0]!.width)),
        config.kind.padEnd(columns[1]!.width),
        config.cpu.padEnd(columns[2]!.width),
        config.memory.padEnd(columns[3]!.width),
        String(config.port).padEnd(columns[4]!.width),
        String(config.min_instances).padEnd(columns[5]!.width),
        String(config.max_instances).padEnd(columns[6]!.width),
        (config.has_database ? chalk.green("yes") : chalk.gray("no")).padEnd(
          columns[7]!.width + 9,
        ), // +9 for color codes
        (config.run_migrations ? chalk.green("yes") : chalk.gray("no")).padEnd(
          columns[8]!.width + 9,
        ),
      ];
      this.runner.logger.log(row.join("  "));
    }

    this.runner.logger.log("");
    this.runner.logger.log(chalk.gray(`Total: ${services.length} service(s)`));
  }

  private getServicesWithConfig(
    services: string[],
  ): Record<string, ServiceConfig> {
    const result: Record<string, ServiceConfig> = {};
    const entries = this.runner.config.project.services.entries;

    for (const service of services) {
      const definition = entries[service];
      if (!definition) continue;

      result[service] = {
        kind: definition.origin.type,
        description: definition.description,
        route: definition.route,
        cpu: definition.infrastructure.cpu,
        memory: definition.infrastructure.memory,
        port: definition.infrastructure.port,
        min_instances: definition.infrastructure.minInstances,
        max_instances: definition.infrastructure.maxInstances,
        has_database: definition.infrastructure.hasDatabase,
        run_migrations: definition.infrastructure.runMigrations,
        static_path: definition.infrastructure.staticPath,
      };
    }

    return result;
  }
}

interface ServiceConfig {
  kind: "inline" | "directory";
  description?: string;
  route?: string;
  cpu: string;
  memory: string;
  port: number;
  min_instances: number;
  max_instances: number;
  has_database: boolean;
  run_migrations: boolean;
  static_path: string;
}
