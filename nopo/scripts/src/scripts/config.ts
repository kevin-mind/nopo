import path from "node:path";
import process from "node:process";
import { Script, type Runner, minimist } from "../lib.ts";
import type { NormalizedService } from "../config/index.ts";

type ConfigAction = "validate";

type ConfigArgs = {
  action: ConfigAction;
  json: boolean;
  servicesOnly: boolean;
  service?: string;
};

export default class ConfigScript extends Script<ConfigArgs> {
  static override name = "config";
  static override description = "Validate and inspect nopo.yml configuration";

  static override parseArgs(runner: Runner): ConfigArgs {
    const argv = runner.argv.slice(1);
    let action: ConfigAction = "validate";
    let optionArgs = argv;

    if (argv[0] === "validate") {
      optionArgs = argv.slice(1);
    }

    const parsed = minimist(optionArgs, {
      boolean: ["json", "services", "services-only"],
      string: ["service"],
      alias: {
        json: "j",
        service: "s",
      },
      default: {
        json: false,
        services: false,
        "services-only": false,
      },
    });

    const servicesOnly =
      Boolean(parsed.services) || Boolean(parsed["services-only"]);

    const service =
      typeof parsed.service === "string" && parsed.service.trim().length > 0
        ? parsed.service.trim()
        : undefined;

    return {
      action,
      json: Boolean(parsed.json),
      servicesOnly,
      service,
    };
  }

  override async fn(args: ConfigArgs) {
    if (args.action !== "validate") {
      throw new Error(`Unsupported config action: ${args.action}`);
    }

    if (args.json) {
      const payload = args.servicesOnly
        ? this.serializeServices(args.service)
        : this.serializeProject();
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }

    const project = this.runner.config.project;
    const totalServices = project.services.order.length;
    const directoryServices = project.services.targets.length;
    const inlineServices = totalServices - directoryServices;

    this.runner.logger.log(
      `✓ Loaded nopo.yml (${directoryServices} directory services, ${inlineServices} inline services)`,
    );
  }

  private serializeProject() {
    const project = this.runner.config.project;
    const services = Object.fromEntries(
      Object.entries(project.services.entries).map(([id, service]) => [
        id,
        this.toServiceSummary(service),
      ]),
    );

    return {
      name: project.name,
      os: project.os,
      services: {
        dir:
          path.relative(this.runner.config.root, project.services.dir) || ".",
        order: project.services.order,
        targets: project.services.targets,
        entries: services,
      },
    };
  }

  private serializeServices(serviceId?: string) {
    const entries = this.runner.config.project.services.entries;
    if (serviceId) {
      const definition = entries[serviceId];
      if (!definition) return null;
      return this.toServiceSummary(definition);
    }

    return Object.fromEntries(
      Object.entries(entries).map(([id, service]) => [
        id,
        this.toServiceSummary(service),
      ]),
    );
  }

  private toServiceSummary(service: NormalizedService) {
    const infrastructure = service.infrastructure;
    const isDirectory = service.origin.type === "directory";
    return {
      id: service.id,
      name: service.name,
      kind: service.origin.type,
      description: service.description,
      static_path: service.staticPath,
      infrastructure: {
        cpu: infrastructure.cpu,
        memory: infrastructure.memory,
        port: infrastructure.port,
        min_instances: infrastructure.minInstances,
        max_instances: infrastructure.maxInstances,
        has_database: infrastructure.hasDatabase,
        run_migrations: infrastructure.runMigrations,
      },
      paths: isDirectory
        ? {
            root:
              path.relative(this.runner.config.root, service.paths.root) || ".",
            dockerfile: path.relative(
              this.runner.config.root,
              service.paths.dockerfile,
            ),
            context:
              path.relative(this.runner.config.root, service.paths.context) ||
              ".",
          }
        : undefined,
    };
  }
}
