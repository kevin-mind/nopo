import { Script, type Runner, exec } from "../lib.ts";
import {
  parseFilterExpression,
  matchesFilter,
  type FilterExpression,
  type FilterContext,
} from "../filter.ts";
import type { TargetType } from "../config/index.ts";
import process from "node:process";

type ListCliArgs = {
  format: "text" | "json" | "csv";
  filters: FilterExpression[];
  since?: string;
  jqFilter?: string;
  validate: boolean;
};

export default class ListScript extends Script<ListCliArgs> {
  static override name = "list";
  static override description = "List discovered services";

  static override parseArgs(
    runner: Runner,
    isDependency: boolean,
  ): ListCliArgs {
    if (isDependency || runner.argv[0] !== "list") {
      return { format: "text", filters: [], validate: false };
    }

    const argv = runner.argv.slice(1);
    let format: "text" | "json" | "csv" = "text";
    const filters: FilterExpression[] = [];
    let since: string | undefined;
    let jqFilter: string | undefined;
    let validate = false;

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
      } else if (arg === "--filter" || arg === "-F") {
        const filterArg = argv[i + 1];
        if (filterArg) {
          filters.push(parseFilterExpression(filterArg));
          i++;
        }
      } else if (arg === "--since") {
        const sinceArg = argv[i + 1];
        if (sinceArg) {
          since = sinceArg;
          i++;
        }
      } else if (arg === "--jq") {
        const jqArg = argv[i + 1];
        if (jqArg) {
          jqFilter = jqArg;
          i++;
        }
      } else if (arg === "--validate" || arg === "-v") {
        validate = true;
      }
    }

    return { format, filters, since, jqFilter, validate };
  }

  override async fn(args: ListCliArgs) {
    const allServices = this.runner.config.targets;
    const filterContext: FilterContext = {
      projectRoot: this.runner.config.root,
      since: args.since,
    };
    const services = this.applyFilters(
      allServices,
      args.filters,
      filterContext,
    );

    // Validate --jq requires --json
    if (args.jqFilter && args.format !== "json") {
      throw new Error("--jq requires --json format");
    }

    // If --validate, just output success message (config already validated during load)
    if (args.validate) {
      const project = this.runner.config.project;
      this.runner.logger.log(
        `✓ Valid nopo.yml: ${project.name} (${services.length} services)`,
      );
      return;
    }

    if (args.format === "json") {
      const output = {
        config: this.getProjectConfig(),
        services: this.getServicesWithConfig(services),
      };
      const jsonOutput = JSON.stringify(output, null, 2);

      // Process through jq if filter provided
      if (args.jqFilter) {
        const result = await this.processJq(jsonOutput, args.jqFilter);
        process.stdout.write(result + "\n");
      } else {
        process.stdout.write(jsonOutput + "\n");
      }
    } else if (args.format === "csv") {
      process.stdout.write(services.join(",") + "\n");
    } else {
      if (services.length === 0) {
        this.runner.logger.log("No services found.");
        return;
      }

      await this.printConfigTable(services);
    }
  }

  private async processJq(jsonInput: string, filter: string): Promise<string> {
    const result = await exec("jq", ["-c", filter], {
      cwd: this.runner.config.root,
      input: jsonInput,
      nothrow: true,
    });

    if (result.exitCode !== 0) {
      const stderr = result.stderr?.trim() || "Unknown error";
      throw new Error(`jq filter failed: ${stderr}`);
    }

    return result.stdout.trim();
  }

  private applyFilters(
    services: string[],
    filters: FilterExpression[],
    context: FilterContext,
  ): string[] {
    if (filters.length === 0) return services;

    const entries = this.runner.config.project.services.entries;

    return services.filter((serviceName) => {
      const service = entries[serviceName];
      if (!service) return false;

      return filters.every((filter) => matchesFilter(service, filter, context));
    });
  }

  private async printConfigTable(services: string[]) {
    const { chalk } = this.runner.logger;
    const configs = this.getServicesWithConfig(services);

    // Define columns
    const columns = [
      { key: "service", header: "SERVICE", width: 12 },
      { key: "type", header: "TYPE", width: 8 },
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
      columns[1]!.width = Math.max(columns[1]!.width, config.cpu.length);
      columns[2]!.width = Math.max(columns[2]!.width, config.memory.length);
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
      const typeLabel =
        config.type === "package"
          ? chalk.blue("package")
          : chalk.magenta("service");
      const row = [
        chalk.yellow(service.padEnd(columns[0]!.width)),
        typeLabel.padEnd(columns[1]!.width + 9), // +9 for color codes
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

  private getProjectConfig(): ProjectConfig {
    const project = this.runner.config.project;
    return {
      name: project.name,
      services_dirs: project.services.dirs,
    };
  }

  private getServicesWithConfig(
    services: string[],
  ): Record<string, ServiceConfig> {
    const result: Record<string, ServiceConfig> = {};
    const entries = this.runner.config.project.services.entries;

    for (const service of services) {
      const definition = entries[service];
      if (!definition) continue;

      // Get runtime values with defaults for packages
      const runtime = definition.runtime;
      result[service] = {
        description: definition.description,
        type: definition.type,
        cpu: runtime?.cpu ?? "1",
        memory: runtime?.memory ?? "512Mi",
        port: runtime?.port ?? 3000,
        min_instances: runtime?.minInstances ?? 0,
        max_instances: runtime?.maxInstances ?? 10,
        has_database: runtime?.hasDatabase ?? false,
        run_migrations: runtime?.runMigrations ?? false,
        static_path: definition.staticPath,
      };
    }

    return result;
  }
}

interface ProjectConfig {
  name: string;
  services_dirs: string[];
}

interface ServiceConfig {
  description?: string;
  type: TargetType;
  cpu: string;
  memory: string;
  port: number;
  min_instances: number;
  max_instances: number;
  has_database: boolean;
  run_migrations: boolean;
  static_path: string;
}
