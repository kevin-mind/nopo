import { describe, it, expect, vi, beforeEach } from "vitest";
import { Runner, createConfig, Logger } from "../src/lib.ts";
import { Environment } from "../src/parse-env.ts";
import { createTmpEnv } from "./utils.ts";
import IndexScript from "../src/scripts/index.ts";
import RunScript from "../src/scripts/run.ts";

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

describe("Execution Modes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Host Execution", () => {
    it("should use pnpm --filter for targeted execution", async () => {
      // nopo lint web
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
      const command = reconstructCommand(mockExec.mock.calls[0] || []);
      expect(command).toContain("pnpm");
      expect(command).toContain("--filter");
      expect(command).toContain("@more/web");
      expect(command).toContain("run");
      expect(command).toContain("lint");
    });

    it("should use pnpm run at root when no targets", async () => {
      // nopo lint
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
      // nopo lint backend web
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

    it("should only run EnvScript dependency for host execution", async () => {
      // IndexScript (catch-all) should only have EnvScript dependency
      expect(IndexScript.dependencies).toHaveLength(1);
      expect(IndexScript.dependencies[0]?.class.name).toBe("env");
    });
  });

  describe("Container Execution (RunScript)", () => {
    it("should use RunScript for container execution", async () => {
      // nopo run lint web
      // Expected: docker compose run --rm web pnpm run lint
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
      // nopo lint web -> IndexScript (catch-all)
      const config = createConfig({
        envFile: createTmpEnv({}),
      });
      const logger = new Logger(config);
      const environment = new Environment(config);
      const runner = new Runner(config, environment, ["lint", "web"], logger);

      const args = IndexScript.parseArgs(runner, false);
      expect(args.command).toBe("lint");
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
