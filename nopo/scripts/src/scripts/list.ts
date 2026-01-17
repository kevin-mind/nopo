import { Script, exec } from "../lib.ts";
import {
  parseFilterExpression,
  matchesFilter,
  type FilterExpression,
  type FilterContext,
} from "../filter.ts";
import type { TargetType } from "../config/index.ts";
import process from "node:process";
import { ScriptArgs } from "../script-args.ts";

export default class ListScript extends Script {
  static override name = "list";
  static override description = "List discovered services";

  static override args = new ScriptArgs({
    format: {
      type: "string",
      description: "Output format (text, json, csv)",
      alias: ["f"],
      default: "text",
    },
    json: {
      type: "boolean",
      description: "Output as JSON (shortcut for --format json)",
      alias: ["j"],
      default: false,
    },
    csv: {
      type: "boolean",
      description: "Output as CSV (shortcut for --format csv)",
      default: false,
    },
    filter: {
      type: "string[]",
      description: "Filter targets by expression",
      alias: ["F"],
      default: [],
    },
    since: {
      type: "string",
      description: "Filter changed files since git ref",
      default: undefined,
    },
    jq: {
      type: "string",
      description: "jq filter expression for JSON output",
      default: undefined,
    },
    validate: {
      type: "boolean",
      description: "Validate configuration only",
      alias: ["v"],
      default: false,
    },
  });

  override async fn(args: ScriptArgs) {
    // Determine format: --json and --csv shortcuts take precedence
    let format: "text" | "json" | "csv" = args.get<string>("format") as
      | "text"
      | "json"
      | "csv";
    if (args.get<boolean>("json")) format = "json";
    if (args.get<boolean>("csv")) format = "csv";

    // Parse filter expressions from string[]
    const filterStrings = args.get<string[]>("filter") ?? [];
    const filters: FilterExpression[] = filterStrings.map(
      parseFilterExpression,
    );

    const since = args.get<string | undefined>("since");
    const jqFilter = args.get<string | undefined>("jq");
    const validate = args.get<boolean>("validate") ?? false;

    const allServices = this.runner.config.targets;
    const filterContext: FilterContext = {
      projectRoot: this.runner.config.root,
      since,
    };
    const services = this.applyFilters(allServices, filters, filterContext);

    // Validate --jq requires --json
    if (jqFilter && format !== "json") {
      throw new Error("--jq requires --json format");
    }

    // If --validate, just output success message (config already validated during load)
    if (validate) {
      const project = this.runner.config.project;
      this.runner.logger.log(
        `✓ Valid nopo.yml: ${project.name} (${services.length} services)`,
      );
      return;
    }

    if (format === "json") {
      const output = {
        config: this.getProjectConfig(),
        services: this.getServicesWithConfig(services),
      };
      const jsonOutput = JSON.stringify(output, null, 2);

      // Process through jq if filter provided
      if (jqFilter) {
        const result = await this.processJq(jsonOutput, jqFilter);
        process.stdout.write(result + "\n");
      } else {
        process.stdout.write(jsonOutput + "\n");
      }
    } else if (format === "csv") {
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
