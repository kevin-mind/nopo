import { path, $, chalk } from "zx";
import { execSync } from "node:child_process";
import prompts from "prompts";
import { Script } from "../lib.js";
import EnvScript from "./env.js";

interface WorkspacePackage {
  name: string;
  path: string;
  scripts: Record<string, string>;
}

interface WorkspaceScript {
  workspace: string;
  command: string;
  script: string;
  virtual: boolean;
}

export default class RunWorkspaceScript extends Script {
  static name = "run";
  static description = "Run a command on one or more packages/apps";
  static dependencies = [EnvScript];

  async getWorkspacePackages(): Promise<WorkspacePackage[]> {
    try {
      const result = await $`pnpm list --recursive --json --depth 0`;
      const packages = JSON.parse(result.stdout);

      const results: WorkspacePackage[] = [];

      for await (const pkg of packages) {
        const pkgPath = path.join(pkg.path, "package.json");
        const { default: pkgjson } = await import(pkgPath);

        results.push({
          name: pkg.name,
          path: pkg.path,
          scripts: pkgjson.scripts,
        });
      }

      return results;
    } catch (error) {
      this.logger.log("Error getting workspace packages:", error);
      return [];
    }
  }

  resolveScript(script: WorkspaceScript) {
    const filter =
      script.workspace != "nopo" ? ` --filter='${script.workspace}' ` : " ";
    const command = script.virtual ? script.script : script.command;
    return `pnpm${filter}run ${command}`;
  }

  async getCommand() {
    const workspacePackages = await this.getWorkspacePackages();
    const globalCommands = new Set<string>();
    const allScripts: WorkspaceScript[] = [];

    for (const pkg of workspacePackages) {
      const workspace = pkg.name;
      for (const [command, script] of Object.entries(pkg.scripts)) {
        if (workspace === "nopo" && command.includes(":")) {
          const globalCommand = command.split(":")[0];
          if (!globalCommands.has(globalCommand)) {
            globalCommands.add(globalCommand);
            allScripts.push({
              workspace: "nopo",
              command: globalCommand,
              script: `/^${globalCommand}:.*/`,
              virtual: true,
            });
          }
        }

        allScripts.push({
          workspace,
          command,
          script,
          virtual: false,
        });
      }
    }

    if ("DOCKER_RUN" in this.config.processEnv) {
      const command = allScripts.find(
        (script) => script.command === this.config.processEnv.DOCKER_RUN,
      );
      if (!command) throw new Error(`Could not find command: ${command}`);
      return this.resolveScript(command);
    }

    const { command } = await prompts({
      name: "command",
      type: "autocomplete",
      message: "Select a command to run",
      suggest: async (input, choices) =>
        choices.filter((i) =>
          i.title.toLowerCase().includes(input.toLowerCase()),
        ),
      choices: allScripts.map((script) => ({
        title: `${script.workspace} ${script.command}`,
        value: script,
        description: script.script,
      })),
    });

    return this.resolveScript(command);
  }

  async fn() {
    const command = await this.getCommand();

    const { confirmed } = await prompts({
      name: "confirmed",
      type: "confirm",
      message: `Run: "${chalk.magenta(command)}"?`,
      initial: true,
    });

    if (confirmed) {
      execSync(command, { stdio: "inherit", cwd: this.config.root });
    }
  }
}
