import { describe, it, expect, vi, beforeEach } from "vitest";
import RunScript from "../../src/scripts/run.ts";
import { Runner, createConfig, Logger } from "../../src/lib.ts";
import { Environment } from "../../src/parse-env.ts";
import { createTmpEnv } from "../utils.ts";

describe("run command (RunScript)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("command behavior", () => {
    it("should have correct name and description", () => {
      expect(RunScript.name).toBe("run");
      expect(RunScript.description).toContain("pnpm script");
    });

    it("should parse run command with script and targets", async () => {
      const config = createConfig({
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
      expect(args.script).toBe("test");
      expect(args.targets).toEqual(["backend", "web"]);
    });

    it("should parse run command with script only", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["run", "dev"], logger);

      const args = RunScript.parseArgs(runner, false);
      expect(args.script).toBe("dev");
      expect(args.targets).toEqual([]);
    });

    it("should handle workspace option", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["run", "lint", "--workspace", "backend"],
        logger,
      );

      const args = RunScript.parseArgs(runner, false);
      expect(args.script).toBe("lint");
      expect(args.workspace).toBe("backend");
      expect(args.targets).toEqual([]);
    });
  });

  describe("target resolution", () => {
    it("should extract targets from positionals", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["run", "lint", "backend", "web"],
        logger,
      );

      const args = RunScript.parseArgs(runner, false);
      expect(args.targets).toEqual(["backend", "web"]);
    });

    it("should return empty targets when none specified", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["run", "lint"], logger);

      const args = RunScript.parseArgs(runner, false);
      expect(args.targets).toEqual([]);
    });
  });

  describe("error handling", () => {
    it("should throw error when script name is missing", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["run"], logger);

      expect(() => {
        RunScript.parseArgs(runner, false);
      }).toThrow("Usage: run [script] [targets...]");
    });

    it("should validate targets against available list", async () => {
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["run", "lint", "unknown-target"],
        logger,
      );

      expect(() => {
        RunScript.parseArgs(runner, false);
      }).toThrow("Unknown target 'unknown-target'");
    });
  });
});
