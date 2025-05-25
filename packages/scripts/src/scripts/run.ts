import { path, $ } from "zx";
import compose from "docker-compose";
import prompts from "prompts";
import { Script } from "../lib.js";
import EnvScript from "./env.js";

interface WorkspacePackage {
  name: string;
  path: string;
  scripts: Record<string, string>;
}

interface StandardScript {
  name: string;
  description: string;
}

export default class RunScript extends Script {
  static name = "run";
  static description = "Run a command on one or more packages/apps";
  static dependencies = [EnvScript];

  sripts: StandardScript[] = [
    {
      name: "build",
      description: "Build the project",
    },
    {
      name: "check",
      description: "Check the project for lint/type errors",
    },
    {
      name: "fix",
      description: "Fix lint/type errors",
    },
    {
      name: "test",
      description: "Run tests",
    },
    {
      name: "exec",
      description: "Run a custom command",
    },
  ];

  async getWorkspacePackages(): Promise<WorkspacePackage[]> {
    try {
      const result = await $`pnpm list --recursive --json --depth 0`;
      const packages = JSON.parse(result.stdout);

      return packages.map((pkg: Record<string, string>) => ({
        name: pkg.name,
        path: path.relative(this.config.root, pkg.path),
        scripts: pkg.scripts,
      }));
    } catch (error) {
      this.logger.log("Error getting workspace packages:", error);
      return [];
    }
  }

  async fn() {
    const workspacePackages = await this.getWorkspacePackages();

    const { command } = await prompts({
      type: "select",
      name: "command",
      message: "Select a command to run",
      choices: this.sripts.map((script) => ({
        title: script.name,
        value: script.name,
        description: script.description,
      })),
    });
    let script = command;
    if (command === "exec") {
      const { exec } = await prompts({
        type: "text",
        name: "exec",
        message: "Enter a command to run",
      });
      script = exec;
    }
    let scriptText = `pnpm run ${script}`;

    const { packages } = await prompts({
      type: "multiselect",
      name: "packages",
      message: "Select packages to run script on",
      choices: workspacePackages.map((pkg) => ({
        title: pkg.name,
        value: pkg.name,
      })),
    });

    if (packages.length > 0 && packages.length < workspacePackages.length) {
      scriptText += ` --filter='${packages.join(" ")}'`;
    }

    const { confirmed } = await prompts({
      type: "confirm",
      name: "confirmed",
      message: `Run: ${scriptText}?`,
      initial: true,
    });

    if (confirmed) {
      await compose.run("base", scriptText, {
        log: true,
        commandOptions: ["--rm"],
      });
    }
  }
}
