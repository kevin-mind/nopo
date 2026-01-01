import { describe, it, expect, vi, beforeEach } from "vitest";
import IndexScript from "../../src/scripts/index.ts";
import { Runner, createConfig, Logger } from "../../src/lib.ts";
import { Environment } from "../../src/parse-env.ts";
import { createTmpEnv } from "../utils.ts";

// Mock the exec property getter to return a mock template tag function
const mockExec = vi
  .fn()
  .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
Object.defineProperty(IndexScript.prototype, "exec", {
  get: () => mockExec,
  configurable: true,
});

// Helper to reconstruct command from template tag call
function reconstructCommand(call: unknown[]): string {
  const templateStrings = call[0] as string[];
  const values = call.slice(1) as unknown[];
  let command = "";
  for (let i = 0; i < templateStrings.length; i++) {
    command += templateStrings[i] || "";
    if (i < values.length) {
      const value = values[i];
      if (Array.isArray(value)) {
        command += value.join(" ");
      } else {
        command += String(value);
      }
    }
  }
  return command.trim();
}

describe("IndexScript (catch-all for arbitrary commands)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseArgs", () => {
    it("should parse command with target: nopo lint web", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["lint", "web"], logger);

      const args = IndexScript.parseArgs(runner, false);
      expect(args).toEqual({
        command: "lint",
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
      const runner = new Runner(config, environment, ["lint"], logger);

      const args = IndexScript.parseArgs(runner, false);
      expect(args).toEqual({
        command: "lint",
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
      const runner = new Runner(config, environment, ["fix", "py", "web"], logger);

      const args = IndexScript.parseArgs(runner, false);
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

      const args = IndexScript.parseArgs(runner, false);
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
        ["lint", "invalid"],
        logger,
      );

      // "invalid" is not a known subcommand, so it's treated as a target
      // and should fail validation
      expect(() => {
        IndexScript.parseArgs(runner, false);
      }).toThrow("Unknown target 'invalid'");
    });

    it("should parse multiple targets: nopo lint backend web", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["lint", "backend", "web"],
        logger,
      );

      const args = IndexScript.parseArgs(runner, false);
      expect(args).toEqual({
        command: "lint",
        subcommand: undefined,
        targets: ["backend", "web"],
      });
    });
  });

  describe("dependencies", () => {
    it("should only have EnvScript dependency for host execution", async () => {
      // IndexScript (catch-all) should only depend on EnvScript
      expect(IndexScript.dependencies).toHaveLength(1);
      expect(IndexScript.dependencies[0]?.class.name).toBe("env");
      expect(IndexScript.dependencies[0]?.enabled).toBe(true);
    });
  });

  describe("execution", () => {
    it("should execute pnpm --filter for each target (pnpm fallback)", async () => {
      // Expected: pnpm --filter @more/web run lint
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["lint", "web"], logger);

      const args = IndexScript.parseArgs(runner, false);
      const script = new IndexScript(runner);

      await script.fn(args);

      expect(mockExec).toHaveBeenCalled();
      // Template tag receives: (strings, ...values)
      const templateStrings = mockExec.mock.calls[0]?.[0] as string[];
      const values = mockExec.mock.calls[0]?.slice(1) as unknown[];
      // Reconstruct the command like $ does
      let command = "";
      for (let i = 0; i < templateStrings.length; i++) {
        command += templateStrings[i] || "";
        if (i < values.length) {
          const value = values[i];
          if (Array.isArray(value)) {
            command += value.join(" ");
          } else {
            command += String(value);
          }
        }
      }
      expect(command).toContain("pnpm");
      expect(command).toContain("--filter");
      expect(command).toContain("@more/web");
      expect(command).toContain("run");
      expect(command).toContain("lint");
    });

    it("should execute pnpm run at root when no targets", async () => {
      // Expected: pnpm run lint
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["lint"], logger);

      const args = IndexScript.parseArgs(runner, false);
      const script = new IndexScript(runner);

      await script.fn(args);

      expect(mockExec).toHaveBeenCalled();
      const command = reconstructCommand(mockExec.mock.calls[0] || []);
      expect(command).toContain("pnpm");
      expect(command).toContain("run");
      expect(command).toContain("lint");
      expect(command).not.toContain("--filter");
    });

    it("should execute for each target when multiple targets specified", async () => {
      // Expected:
      //   pnpm --filter @more/backend run lint
      //   pnpm --filter @more/web run lint
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["lint", "backend", "web"],
        logger,
      );

      const args = IndexScript.parseArgs(runner, false);
      const script = new IndexScript(runner);

      await script.fn(args);

      expect(mockExec).toHaveBeenCalledTimes(2);
      const firstCommand = reconstructCommand(mockExec.mock.calls[0] || []);
      const secondCommand = reconstructCommand(mockExec.mock.calls[1] || []);
      expect(firstCommand).toContain("@more/backend");
      expect(secondCommand).toContain("@more/web");
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

      const args = IndexScript.parseArgs(runner, false);
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
      const runner = new Runner(config, environment, ["fix", "py", "backend"], logger);

      const args = IndexScript.parseArgs(runner, false);
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

      const args = IndexScript.parseArgs(runner, false);
      // "web" is not a subcommand of "build", so treat as target
      expect(args.command).toBe("build");
      expect(args.subcommand).toBeUndefined();
      expect(args.targets).toEqual(["web"]);
    });
  });
});
