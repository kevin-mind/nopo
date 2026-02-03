import { Script, exec, minimist } from "../lib.ts";
import { ScriptArgs } from "../script-args.ts";
import process from "node:process";

export default class ActScript extends Script {
  static override name = "act";
  static override description = "Run GitHub Actions locally with act";

  static override args = new ScriptArgs({
    workflow: {
      type: "string",
      description: "Workflow file to run (e.g., ci.yml)",
      alias: ["w"],
      default: undefined,
    },
    job: {
      type: "string",
      description: "Specific job to run",
      alias: ["j"],
      default: undefined,
    },
    event: {
      type: "string",
      description: "Event type to simulate (default: workflow_dispatch)",
      alias: ["e"],
      default: "workflow_dispatch",
    },
    dry: {
      type: "boolean",
      description: "Dry run (validate without executing)",
      alias: ["n"],
      default: false,
    },
    verbose: {
      type: "boolean",
      description: "Verbose output",
      alias: ["v"],
      default: false,
    },
    input: {
      type: "string[]",
      description: "Workflow inputs (key=value)",
      alias: ["i"],
      default: [],
    },
  });

  override async fn(args: ScriptArgs) {
    const { chalk } = this.runner.logger;
    // Get subcommand from argv (first arg after "act")
    const argv = this.runner.argv.slice(1); // Remove "act"
    const parsed = minimist(argv);
    const subcommand = parsed._[0];

    // Check if act is installed
    const actCheck = await exec("which", ["act"], { nothrow: true });
    if (actCheck.exitCode !== 0) {
      this.runner.logger.log(
        chalk.red(
          "Error: act is not installed. Install with: brew install act",
        ),
      );
      process.exit(1);
    }

    // Route to subcommand
    switch (subcommand) {
      case "list":
        await this.list();
        break;
      case "run":
        await this.run(args);
        break;
      case "dry":
        await this.runDry(args);
        break;
      default:
        this.printUsage();
        break;
    }
  }

  private printUsage() {
    const { chalk } = this.runner.logger;
    this.runner.logger.log(
      chalk.cyan(chalk.bold("\nUsage: nopo act <subcommand> [options]\n")),
    );
    this.runner.logger.log(chalk.bold("Subcommands:"));
    this.runner.logger.log(
      "  list                     List all workflows and jobs",
    );
    this.runner.logger.log("  run -w <workflow>        Run a workflow");
    this.runner.logger.log(
      "  dry -w <workflow>        Dry run (validate only)",
    );
    this.runner.logger.log("");
    this.runner.logger.log(chalk.bold("Examples:"));
    this.runner.logger.log("  nopo act list");
    this.runner.logger.log("  nopo act run -w ci.yml");
    this.runner.logger.log("  nopo act run -w ci.yml -j test");
    this.runner.logger.log(
      "  nopo act dry -w _test_state_machine.yml -i scenario_name=triage",
    );
    this.runner.logger.log("");
    this.runner.logger.log(chalk.bold("Setup:"));
    this.runner.logger.log(
      "  cp .secrets.example .secrets   # Add your tokens",
    );
    this.runner.logger.log(
      "  cp .vars.example .vars         # Add repo variables",
    );
    this.runner.logger.log("");
  }

  private async list() {
    const result = await exec("act", ["-l"], {
      cwd: this.runner.config.root,
      stdio: "inherit",
      nothrow: true,
    });
    process.exit(result.exitCode);
  }

  private async run(args: ScriptArgs) {
    const actArgs = this.buildActArgs(args, false);
    const result = await exec("act", actArgs, {
      cwd: this.runner.config.root,
      stdio: "inherit",
      nothrow: true,
    });
    process.exit(result.exitCode);
  }

  private async runDry(args: ScriptArgs) {
    const actArgs = this.buildActArgs(args, true);
    const result = await exec("act", actArgs, {
      cwd: this.runner.config.root,
      stdio: "inherit",
      nothrow: true,
    });
    process.exit(result.exitCode);
  }

  private buildActArgs(args: ScriptArgs, dryRun: boolean): string[] {
    const { chalk } = this.runner.logger;
    const workflow = args.get<string | undefined>("workflow");
    const job = args.get<string | undefined>("job");
    const event = args.get<string>("event") || "workflow_dispatch";
    const verbose = args.get<boolean>("verbose");
    const inputs = args.get<string[]>("input") || [];

    if (!workflow) {
      this.runner.logger.log(chalk.red("Error: --workflow (-w) is required"));
      this.printUsage();
      process.exit(1);
    }

    const actArgs: string[] = [event];

    // Add workflow file
    actArgs.push("-W", `.github/workflows/${workflow}`);

    // Add job if specified
    if (job) {
      actArgs.push("-j", job);
    }

    // Add dry run flag
    if (dryRun) {
      actArgs.push("-n");
    }

    // Add verbose flag
    if (verbose) {
      actArgs.push("--verbose");
    }

    // Add inputs
    for (const input of inputs) {
      actArgs.push("--input", input);
    }

    return actArgs;
  }
}
