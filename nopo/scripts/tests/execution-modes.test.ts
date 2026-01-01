import { describe, it, expect, vi, beforeEach } from "vitest";
import { Runner, createConfig, Logger, exec } from "../src/lib.ts";
import { Environment } from "../src/parse-env.ts";
import { createTmpEnv } from "./utils.ts";
import IndexScript from "../src/scripts/index.ts";
import RunScript from "../src/scripts/run.ts";

// Mock the exec function
vi.mock("../src/lib.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib.ts")>();
  return {
    ...original,
    exec: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
  };
});

describe("Execution Modes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Host Execution (nopo.yml commands)", () => {
    it("should execute command defined in nopo.yml", async () => {
      // nopo test web
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["test", "web"], logger);

      const args = IndexScript.parseArgs(runner, false);
      const script = new IndexScript(runner);
      await script.fn(args);

      expect(exec).toHaveBeenCalled();
      expect(exec).toHaveBeenCalledWith(
        "echo",
        ["'test'"],
        expect.objectContaining({
          cwd: expect.stringContaining("apps/web"),
        }),
      );
    });

    it("should execute on multiple targets", async () => {
      // nopo clean backend web
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["clean", "backend", "web"], logger);

      const args = IndexScript.parseArgs(runner, false);
      const script = new IndexScript(runner);
      await script.fn(args);

      // Should execute on both backend and web
      expect(exec).toHaveBeenCalledTimes(2);
    });

    it("should throw error for undefined command", async () => {
      // nopo undefined-command web
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

      const args = IndexScript.parseArgs(runner, false);
      const script = new IndexScript(runner);

      await expect(script.fn(args)).rejects.toThrow(
        /does not define command 'undefined-command'/,
      );
    });

    it("should only run EnvScript dependency for host execution", async () => {
      // IndexScript should only have EnvScript dependency
      expect(IndexScript.dependencies).toHaveLength(1);
      expect(IndexScript.dependencies[0]?.class.name).toBe("env");
    });
  });

  describe("Container Execution (RunScript)", () => {
    it("should use RunScript for container execution", async () => {
      // nopo run lint web
      // RunScript handles this - see tests/scripts/run.test.ts
      const config = createConfig({
        envFile: createTmpEnv({}),
        silent: true,
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["run", "lint", "web"],
        logger,
      );

      const args = RunScript.parseArgs(runner, false);
      expect(args.script).toBe("lint");
      expect(args.targets).toEqual(["web"]);
    });

    it("should resolve full dependencies before execution", async () => {
      // RunScript should have full dependencies
      expect(RunScript.dependencies.length).toBeGreaterThan(1);
      expect(
        RunScript.dependencies.some(
          (d: { class: { name: string } }) => d.class.name === "env",
        ),
      ).toBe(true);
    });
  });

  describe("Execution Mode Detection", () => {
    it("should use IndexScript when 'run' prefix is not used", async () => {
      // nopo build web -> IndexScript
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["build", "web"], logger);

      const args = IndexScript.parseArgs(runner, false);
      expect(args.command).toBe("build");
      expect(args.targets).toEqual(["web"]);
    });

    it("should use RunScript when 'run' prefix is used", async () => {
      // nopo run lint web -> RunScript
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(
        config,
        environment,
        ["run", "lint", "web"],
        logger,
      );

      const args = RunScript.parseArgs(runner, false);
      expect(args.script).toBe("lint");
      expect(args.targets).toEqual(["web"]);
    });
  });
});
