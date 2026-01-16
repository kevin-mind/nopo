import { describe, it, expect, vi, beforeEach } from "vitest";
import CommandScript from "../../src/scripts/command.ts";
import { Runner, Logger, exec } from "../../src/lib.ts";
import { Environment } from "../../src/parse-env.ts";
import { createTmpEnv, createTestConfig, FIXTURES_ROOT } from "../utils.ts";
import compose from "docker-compose";

// Mock the exec function
vi.mock("../../src/lib.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib.ts")>();
  return {
    ...original,
    exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
  };
});

// Mock docker-compose
vi.mock("docker-compose", () => ({
  default: {
    run: vi.fn().mockResolvedValue({ exitCode: 0 }),
    ps: vi.fn().mockResolvedValue({ exitCode: 0, data: { services: [] } }),
  },
}));

describe("CommandScript (run commands defined in nopo.yml)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseArgs", () => {
    it("should parse command with target: nopo build web", async () => {
      const config = createTestConfig({
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
        filters: [],
        since: undefined,
        explicitTargets: true,
      });
    });

    it("should parse command without targets", async () => {
      const config = createTestConfig({
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
        filters: [],
        since: undefined,
        explicitTargets: false,
      });
    });

    it("should parse command with subcommand and target: nopo fix py web", async () => {
      const config = createTestConfig({
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
        filters: [],
        since: undefined,
        explicitTargets: true,
      });
    });

    it("should parse command with subcommand only: nopo fix py", async () => {
      const config = createTestConfig({
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
        filters: [],
        since: undefined,
        explicitTargets: false,
      });
    });

    it("should validate targets", async () => {
      const config = createTestConfig({
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
      const config = createTestConfig({
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
        filters: [],
        since: undefined,
        explicitTargets: true,
      });
    });
  });

  describe("dependencies", () => {
    it("should have EnvScript, BuildScript, and PullScript dependencies", async () => {
      // CommandScript has 3 dependencies:
      // - EnvScript (always enabled)
      // - BuildScript (conditionally enabled for container execution)
      // - PullScript (conditionally enabled for container execution)
      expect(CommandScript.dependencies).toHaveLength(3);
      expect(CommandScript.dependencies[0]?.class.name).toBe("env");
      expect(CommandScript.dependencies[0]?.enabled).toBe(true);
      expect(CommandScript.dependencies[1]?.class.name).toBe("build");
      expect(typeof CommandScript.dependencies[1]?.enabled).toBe("function");
      expect(CommandScript.dependencies[2]?.class.name).toBe("pull");
      expect(typeof CommandScript.dependencies[2]?.enabled).toBe("function");
    });
  });

  describe("execution", () => {
    it("should execute command on target service", async () => {
      const config = createTestConfig({
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
        "sh",
        ["-c", "echo 'test'"],
        expect.objectContaining({
          cwd: expect.stringContaining("apps/web"),
        }),
      );
    });

    it("should execute command on multiple targets", async () => {
      const config = createTestConfig({
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
      const config = createTestConfig({
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
      const config = createTestConfig({
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
      const config = createTestConfig({
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
      const config = createTestConfig({
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

  describe("container execution", () => {
    it("should execute in container when command has context: container in config", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({}),
        rootDir: FIXTURES_ROOT,
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      // "dev" command in complex fixture has context: container
      const runner = new Runner(
        config,
        environment,
        ["dev", "complex"],
        logger,
      );

      const args = CommandScript.parseArgs(runner, false);
      const script = new CommandScript(runner);

      await script.fn(args);

      // Should use docker-compose run, not exec
      expect(compose.run).toHaveBeenCalled();
      expect(compose.run).toHaveBeenCalledWith(
        "complex",
        ["sh", "-c", 'echo "FIXTURE_COMPLEX_DEV_SUCCESS"'],
        expect.objectContaining({
          commandOptions: expect.arrayContaining(["--rm", "--remove-orphans"]),
        }),
      );
      // exec should NOT be called for container execution
      expect(exec).not.toHaveBeenCalled();
    });

    it("should execute in container when --context container flag is passed", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({}),
        rootDir: FIXTURES_ROOT,
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      // "test" command in complex fixture has no context (defaults to host)
      // but we override with --context container
      const runner = new Runner(
        config,
        environment,
        ["test", "complex", "--context", "container"],
        logger,
      );

      const args = CommandScript.parseArgs(runner, false);
      expect(args.contextOverride).toBe("container");

      const script = new CommandScript(runner);
      await script.fn(args);

      // Should use docker-compose run due to --context container flag
      expect(compose.run).toHaveBeenCalled();
      expect(compose.run).toHaveBeenCalledWith(
        "complex",
        ["sh", "-c", 'echo "FIXTURE_COMPLEX_TEST_SUCCESS"'],
        expect.objectContaining({
          commandOptions: expect.arrayContaining(["--rm", "--remove-orphans"]),
        }),
      );
      expect(exec).not.toHaveBeenCalled();
    });

    it("should execute on host when --context host flag overrides container config", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({}),
        rootDir: FIXTURES_ROOT,
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      // "dev" command in complex fixture has context: container
      // but we override with --context host
      const runner = new Runner(
        config,
        environment,
        ["dev", "complex", "--context", "host"],
        logger,
      );

      const args = CommandScript.parseArgs(runner, false);
      expect(args.contextOverride).toBe("host");

      const script = new CommandScript(runner);
      await script.fn(args);

      // Should use exec (host) due to --context host override
      expect(exec).toHaveBeenCalled();
      expect(exec).toHaveBeenCalledWith(
        "sh",
        ["-c", 'echo "FIXTURE_COMPLEX_DEV_SUCCESS"'],
        expect.objectContaining({
          cwd: expect.stringContaining("fixtures/services/complex"),
        }),
      );
      expect(compose.run).not.toHaveBeenCalled();
    });

    it("should inherit container context to subcommands", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({}),
        rootDir: FIXTURES_ROOT,
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      // "lint" command in complex fixture has context: container with subcommands
      const runner = new Runner(
        config,
        environment,
        ["lint", "py", "complex"],
        logger,
      );

      const args = CommandScript.parseArgs(runner, false);
      const script = new CommandScript(runner);

      await script.fn(args);

      // Subcommand should inherit container context from parent
      expect(compose.run).toHaveBeenCalled();
      expect(compose.run).toHaveBeenCalledWith(
        "complex",
        ["sh", "-c", 'echo "FIXTURE_COMPLEX_LINT_PY_SUCCESS"'],
        expect.objectContaining({
          commandOptions: expect.arrayContaining(["--rm", "--remove-orphans"]),
        }),
      );
      expect(exec).not.toHaveBeenCalled();
    });

    it("should set correct workdir for container execution", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({}),
        rootDir: FIXTURES_ROOT,
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["dev", "complex"],
        logger,
      );

      const args = CommandScript.parseArgs(runner, false);
      const script = new CommandScript(runner);

      await script.fn(args);

      // Should set --workdir to container path (not host path)
      expect(compose.run).toHaveBeenCalledWith(
        "complex",
        expect.any(Array),
        expect.objectContaining({
          commandOptions: expect.arrayContaining([
            "--workdir",
            "/app/services/complex",
          ]),
        }),
      );
    });
  });
});
