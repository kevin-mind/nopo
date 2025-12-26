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
    it("should parse host execution command: nopo lint web", async () => {
      // Expected: { script: "lint", targets: ["web"] }
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["lint", "web"], logger);

      const args = IndexScript.parseArgs(runner, false);
      expect(args).toEqual({
        script: "lint",
        targets: ["web"],
      });
    });

    it("should parse command without targets", async () => {
      // Expected: { script: "lint", targets: [] }
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["lint"], logger);

      const args = IndexScript.parseArgs(runner, false);
      expect(args).toEqual({
        script: "lint",
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

      expect(() => {
        IndexScript.parseArgs(runner, false);
      }).toThrow("Unknown target 'invalid'");
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
    it("should execute pnpm --filter for each target", async () => {
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

  describe("pattern matching", () => {
    it("should use exact script name when script does not end with ':'", async () => {
      // Expected: pnpm run lint (exact match)
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["lint"], logger);

      const args = IndexScript.parseArgs(runner, false);
      expect(args.script).toBe("lint");
      expect(args.script.endsWith(":")).toBe(false);
    });

    it("should use regex pattern when script ends with ':'", async () => {
      // Expected: script name should end with ':' for pattern matching
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["lint:"], logger);

      const args = IndexScript.parseArgs(runner, false);
      expect(args.script).toBe("lint:");
      expect(args.script.endsWith(":")).toBe(true);
    });

    it("should parse pattern matching script with targets", async () => {
      // Expected: { script: "lint:", targets: ["web"] }
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["lint:", "web"], logger);

      const args = IndexScript.parseArgs(runner, false);
      expect(args.script).toBe("lint:");
      expect(args.targets).toEqual(["web"]);
    });

    it("should resolve exact script name correctly", () => {
      // Test the internal #resolveScript method behavior via parseArgs
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);

      // Exact match case
      const exactRunner = new Runner(config, environment, ["lint"], logger);
      const exactArgs = IndexScript.parseArgs(exactRunner, false);
      expect(exactArgs.script).toBe("lint");
      expect(exactArgs.script).not.toContain("/^");
      expect(exactArgs.script).not.toContain(".*/");
    });

    it("should resolve pattern matching script name correctly", () => {
      // Test the internal #resolveScript method behavior via parseArgs
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);

      // Pattern match case
      const patternRunner = new Runner(config, environment, ["lint:"], logger);
      const patternArgs = IndexScript.parseArgs(patternRunner, false);
      expect(patternArgs.script).toBe("lint:");
      expect(patternArgs.script.endsWith(":")).toBe(true);
    });

    it("should handle pattern matching with multiple targets", async () => {
      // Expected: pattern matching should work with multiple targets
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["test:", "backend", "web"],
        logger,
      );

      const args = IndexScript.parseArgs(runner, false);
      expect(args.script).toBe("test:");
      expect(args.targets).toEqual(["backend", "web"]);
    });

    it("should handle complex pattern names", async () => {
      // Test with more complex pattern names
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);

      const runner = new Runner(config, environment, ["build:prod:"], logger);
      const args = IndexScript.parseArgs(runner, false);
      expect(args.script).toBe("build:prod:");
      expect(args.script.endsWith(":")).toBe(true);
    });
  });
});
