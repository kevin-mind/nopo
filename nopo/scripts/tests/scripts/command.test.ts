import { describe, it, expect, vi, beforeEach } from "vitest";
import CommandScript from "../../src/scripts/command.ts";
import { Runner, createConfig, Logger, exec } from "../../src/lib.ts";
import { Environment } from "../../src/parse-env.ts";
import { createTmpEnv } from "../utils.ts";

// Mock the exec function
vi.mock("../../src/lib.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib.ts")>();
  return {
    ...original,
    exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
  };
});

describe("CommandScript (run commands defined in nopo.yml)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseArgs", () => {
    it("should parse command with target: nopo build web", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["build", "web"], logger);

      const args = CommandScript.parseArgs(runner, false);
      expect(args).toEqual({
        command: "build",
        subcommand: undefined,
        targets: ["web"],
      });
    });

    it("should parse command without targets", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["build"], logger);

      const args = CommandScript.parseArgs(runner, false);
      expect(args).toEqual({
        command: "build",
        subcommand: undefined,
        targets: [],
      });
    });

    it("should parse command with subcommand and target: nopo fix py web", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["fix", "py", "web"],
        logger,
      );

      const args = CommandScript.parseArgs(runner, false);
      // "py" is recognized as a subcommand because it exists in backend's fix command
      expect(args).toEqual({
        command: "fix",
        subcommand: "py",
        targets: ["web"],
      });
    });

    it("should parse command with subcommand only: nopo fix py", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["fix", "py"], logger);

      const args = CommandScript.parseArgs(runner, false);
      expect(args).toEqual({
        command: "fix",
        subcommand: "py",
        targets: [],
      });
    });

    it("should validate targets", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["build", "invalid"],
        logger,
      );

      // "invalid" is not a known subcommand, so it's treated as a target
      // and should fail validation
      expect(() => {
        CommandScript.parseArgs(runner, false);
      }).toThrow("Unknown target 'invalid'");
    });

    it("should parse multiple targets: nopo build backend web", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["build", "backend", "web"],
        logger,
      );

      const args = CommandScript.parseArgs(runner, false);
      expect(args).toEqual({
        command: "build",
        subcommand: undefined,
        targets: ["backend", "web"],
      });
    });
  });

  describe("dependencies", () => {
    it("should only have EnvScript dependency for host execution", async () => {
      // CommandScript (catch-all) should only depend on EnvScript
      expect(CommandScript.dependencies).toHaveLength(1);
      expect(CommandScript.dependencies[0]?.class.name).toBe("env");
      expect(CommandScript.dependencies[0]?.enabled).toBe(true);
    });
  });

  describe("execution", () => {
    it("should execute command on target service", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["test", "web"], logger);

      const args = CommandScript.parseArgs(runner, false);
      const script = new CommandScript(runner);

      await script.fn(args);

      expect(exec).toHaveBeenCalled();
      // Check that exec was called with the right command
      expect(exec).toHaveBeenCalledWith(
        "echo",
        ["'test'"],
        expect.objectContaining({
          cwd: expect.stringContaining("apps/web"),
        }),
      );
    });

    it("should execute command on multiple targets", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["clean", "backend", "web"],
        logger,
      );

      const args = CommandScript.parseArgs(runner, false);
      const script = new CommandScript(runner);

      await script.fn(args);

      // Should execute on both backend and web
      expect(exec).toHaveBeenCalledTimes(2);
    });

    it("should throw error for undefined command", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["undefined-command", "web"],
        logger,
      );

      const args = CommandScript.parseArgs(runner, false);
      const script = new CommandScript(runner);

      await expect(script.fn(args)).rejects.toThrow(
        /does not define command 'undefined-command'/,
      );
    });
  });

  describe("subcommand detection", () => {
    it("should detect known subcommand: nopo fix py", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["fix", "py"], logger);

      const args = CommandScript.parseArgs(runner, false);
      expect(args.command).toBe("fix");
      expect(args.subcommand).toBe("py");
      expect(args.targets).toEqual([]);
    });

    it("should detect known subcommand with target: nopo fix py backend", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["fix", "py", "backend"],
        logger,
      );

      const args = CommandScript.parseArgs(runner, false);
      expect(args.command).toBe("fix");
      expect(args.subcommand).toBe("py");
      expect(args.targets).toEqual(["backend"]);
    });

    it("should treat unknown arg as target when it's a valid service", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["build", "web"], logger);

      const args = CommandScript.parseArgs(runner, false);
      // "web" is not a subcommand of "build", so treat as target
      expect(args.command).toBe("build");
      expect(args.subcommand).toBeUndefined();
      expect(args.targets).toEqual(["web"]);
    });
  });
});
