import { describe, it, expect, vi, beforeEach } from "vitest";
import RunScript from "../../src/scripts/run.ts";
import { Runner, Logger } from "../../src/lib.ts";
import { Environment } from "../../src/parse-env.ts";
import { createTmpEnv, createTestConfig } from "../utils.ts";

describe("run command (RunScript)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("command behavior", () => {
    it("should have correct name and description", () => {
      expect(RunScript.name).toBe("run");
      expect(RunScript.description).toContain("nopo.yml command");
    });

    it("should parse run command with command and targets", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["run", "test", "backend", "web"],
        logger,
      );

      const args = RunScript.parseArgs(runner, false);
      expect(args.command).toBe("test");
      expect(args.targets).toEqual(["backend", "web"]);
    });

    it("should parse run command with command only", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["run", "dev"], logger);

      const args = RunScript.parseArgs(runner, false);
      expect(args.command).toBe("dev");
      expect(args.targets).toEqual([]);
    });

    it("should handle filter option", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["run", "check", "--filter", "buildable"],
        logger,
      );

      const args = RunScript.parseArgs(runner, false);
      expect(args.command).toBe("check");
      // With buildable filter, targets are filtered to only backend and web
      expect(args.targets).toEqual(["backend", "web"]);
    });

    it("should parse subcommand correctly", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["run", "check", "py", "backend"],
        logger,
      );

      const args = RunScript.parseArgs(runner, false);
      expect(args.command).toBe("check");
      expect(args.subcommand).toBe("py");
      expect(args.targets).toEqual(["backend"]);
    });
  });

  describe("target resolution", () => {
    it("should extract targets from positionals", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["run", "check", "backend", "web"],
        logger,
      );

      const args = RunScript.parseArgs(runner, false);
      expect(args.targets).toEqual(["backend", "web"]);
    });

    it("should return empty targets when none specified", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["run", "check"], logger);

      const args = RunScript.parseArgs(runner, false);
      expect(args.targets).toEqual([]);
    });
  });

  describe("error handling", () => {
    it("should return empty args when command name is missing", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["run"], logger);

      // When only "run" is provided, parseArgs returns empty args
      // (the fn method will throw the error about command being required)
      const args = RunScript.parseArgs(runner, false);
      expect(args.command).toBe("");
    });

    it("should validate targets against available list", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["run", "check", "unknown-target"],
        logger,
      );

      expect(() => {
        RunScript.parseArgs(runner, false);
      }).toThrow("Unknown target 'unknown-target'");
    });
  });
});
