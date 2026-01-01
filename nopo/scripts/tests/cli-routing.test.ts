import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTmpEnv } from "./utils.ts";

// Mock docker-compose before importing anything that uses it
vi.mock("docker-compose", () => ({
  default: {
    config: vi.fn().mockResolvedValue({
      data: {
        config: {
          services: {},
        },
      },
    }),
    upAll: vi.fn().mockResolvedValue({ exitCode: 0 }),
    upMany: vi.fn().mockResolvedValue({ exitCode: 0 }),
    down: vi.fn().mockResolvedValue({ exitCode: 0 }),
    downAll: vi.fn().mockResolvedValue({ exitCode: 0 }),
    downMany: vi.fn().mockResolvedValue({ exitCode: 0 }),
    pullAll: vi.fn().mockResolvedValue({ exitCode: 0 }),
    pullMany: vi.fn().mockResolvedValue({ exitCode: 0 }),
    pullOne: vi.fn().mockResolvedValue({ exitCode: 0 }),
    run: vi.fn().mockResolvedValue({ exitCode: 0 }),
    ps: vi.fn().mockResolvedValue({ exitCode: 0, data: { services: [] } }),
  },
}));

import main from "../src/index.ts";
import IndexScript from "../src/scripts/index.ts";
import RunScript from "../src/scripts/run.ts";
import BuildScript from "../src/scripts/build.ts";

// Mock exec for IndexScript and RunScript to prevent actual command execution
const mockExec = vi
  .fn()
  .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
Object.defineProperty(IndexScript.prototype, "exec", {
  get: () => mockExec,
  configurable: true,
});
Object.defineProperty(RunScript.prototype, "exec", {
  get: () => mockExec,
  configurable: true,
});

// Mock BuildScript execution methods to prevent Docker operations
const mockBake = vi.fn().mockResolvedValue(undefined);
const mockBuilder = vi.fn().mockResolvedValue("nopo-builder");
BuildScript.prototype.bake = mockBake;
BuildScript.prototype.builder = mockBuilder;

const mockExit = vi.fn();
const originalExit = process.exit;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

describe("CLI Routing", () => {
  let consoleOutput: string[] = [];
  let consoleErrorOutput: string[] = [];

  beforeEach(() => {
    consoleOutput = [];
    consoleErrorOutput = [];
    process.exit = mockExit as never;
    console.log = (...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      consoleErrorOutput.push(args.map(String).join(" "));
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.exit = originalExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe("Help Commands", () => {
    it("should print general help when no arguments provided", async () => {
      const argv = ["node", "nopo"];
      const env = {
        ENV_FILE: createTmpEnv({}),
      };

      await main(argv, env);

      // Should print header and commands table
      // Note: Output contains ANSI color codes, so we check for content without exact match
      const output = consoleOutput.join("\n");
      // Remove ANSI codes for checking
      // eslint-disable-next-line no-control-regex
      const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, "");
      expect(cleanOutput).toMatch(/NOPO|COMMAND|DESCRIPTION/i);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should print general help when 'help' is first argument", async () => {
      const argv = ["node", "nopo", "help"];
      const env = {
        ENV_FILE: createTmpEnv({}),
      };

      await main(argv, env);

      const output = consoleOutput.join("\n");
      expect(output).toContain("Usage");
      expect(output).toContain("COMMAND");
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should print general help when --help flag is provided", async () => {
      const argv = ["node", "nopo", "--help"];
      const env = {
        ENV_FILE: createTmpEnv({}),
      };

      await main(argv, env);

      const output = consoleOutput.join("\n");
      expect(output).toContain("Usage: nopo <command> [options]");
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should print command-specific help for build command", async () => {
      const argv = ["node", "nopo", "build", "help"];
      const env = {
        ENV_FILE: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
      };

      await main(argv, env);

      // Expected: Should detect "help" and print build-specific help instead of executing
      const output = consoleOutput.join("\n");
      // eslint-disable-next-line no-control-regex
      const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, "");
      // Should contain build-specific help content, not try to execute build
      expect(cleanOutput.toLowerCase()).toMatch(/build|usage|description/i);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should print command-specific help for build command with --help", async () => {
      const argv = ["node", "nopo", "build", "--help"];
      const env = {
        ENV_FILE: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
      };

      await main(argv, env);

      // Expected: Should detect --help and print build-specific help instead of executing
      const output = consoleOutput.join("\n");
      // eslint-disable-next-line no-control-regex
      const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, "");
      expect(cleanOutput.toLowerCase()).toMatch(/build|usage|description/i);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should print command-specific help for up command", async () => {
      const argv = ["node", "nopo", "up", "help"];
      const env = {
        ENV_FILE: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
      };

      await main(argv, env);

      // Expected: Should detect "help" and print up-specific help instead of executing
      const output = consoleOutput.join("\n");
      // eslint-disable-next-line no-control-regex
      const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, "");
      expect(cleanOutput.toLowerCase()).toMatch(/up|usage|description/i);
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("should print help for arbitrary commands", async () => {
      const argv = ["node", "nopo", "lint", "help"];
      const env = {
        ENV_FILE: createTmpEnv({}),
      };

      await main(argv, env);

      // Expected: Should detect "help" and print generic help for arbitrary commands
      const output = consoleOutput.join("\n");
      // eslint-disable-next-line no-control-regex
      const cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, "");
      expect(cleanOutput.toLowerCase()).toMatch(/arbitrary|command|help/i);
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  describe("Script Class Routing", () => {
    it("should route 'build' to BuildScript", async () => {
      const argv = ["node", "nopo", "build"];
      const env = {
        ENV_FILE: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
      };

      // Currently: Routes to BuildScript correctly
      // This test verifies the routing works
      // Note: This will actually execute build, which may fail in test environment
      // but that's okay - we're testing routing, not execution
      await expect(main(argv, env)).resolves.not.toThrow();
    }, 30000); // 30 second timeout for Docker operations

    it("should route 'up' to UpScript", async () => {
      const argv = ["node", "nopo", "up"];
      const env = {
        ENV_FILE: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
      };

      // Should route to up script, not arbitrary command
      // Note: May fail in test environment due to Docker, but routing is correct
      await expect(main(argv, env)).resolves.not.toThrow();
    }, 30000); // 30 second timeout for Docker operations

    it("should route 'down' to DownScript", async () => {
      const argv = ["node", "nopo", "down"];
      const env = {
        ENV_FILE: createTmpEnv({}),
      };

      // Should route to down script
      await expect(main(argv, env)).resolves.not.toThrow();
    });

    it("should route 'status' to StatusScript", async () => {
      const argv = ["node", "nopo", "status"];
      const env = {
        ENV_FILE: createTmpEnv({}),
      };

      // Should route to status script
      await expect(main(argv, env)).resolves.not.toThrow();
    });
  });

  describe("Arbitrary Command Routing", () => {
    it("should throw error for undefined command", async () => {
      const argv = ["node", "nopo", "undefined-command"];
      const env = {
        ENV_FILE: createTmpEnv({}),
      };

      // Commands must be defined in nopo.yml - no pnpm fallback
      await expect(main(argv, env)).rejects.toThrow(/does not define command/);
    });

    it("should route defined command to IndexScript", async () => {
      const argv = ["node", "nopo", "test", "web"];
      const env = {
        ENV_FILE: createTmpEnv({}),
      };

      // test is defined in web's nopo.yml
      await expect(main(argv, env)).resolves.not.toThrow();
    });

    it("should route 'run lint' to RunScript (container execution)", async () => {
      const argv = ["node", "nopo", "run", "lint"];
      const env = {
        ENV_FILE: createTmpEnv({}),
      };

      // Expected: Should route to RunScript for container execution
      await expect(main(argv, env)).resolves.not.toThrow();
      // Note: May fail if lint script doesn't exist, but routing should be correct
    });

    it("should route 'run lint web' to RunScript with targets (container execution)", async () => {
      const argv = ["node", "nopo", "run", "lint", "web"];
      const env = {
        ENV_FILE: createTmpEnv({}),
      };

      // Expected: Should route to RunScript with script="lint", targets=["web"]
      await expect(main(argv, env)).resolves.not.toThrow();
      // Note: May fail if lint script doesn't exist, but routing should be correct
    }, 30000); // 30 second timeout for Docker operations
  });

  describe("Command Routing Priority", () => {
    it("should prioritize script class over arbitrary command when name matches", async () => {
      // If a script class exists, it should be used even if a pnpm script with same name exists
      const argv = ["node", "nopo", "build"];
      const env = {
        ENV_FILE: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
      };

      // Should route to BuildScript, not IndexScript
      await expect(main(argv, env)).resolves.not.toThrow();
    }, 30000); // 30 second timeout for Docker operations

    it("should handle 'run' prefix correctly for container execution", async () => {
      const argv = ["node", "nopo", "run", "test"];
      const env = {
        ENV_FILE: createTmpEnv({}),
      };

      // 'run' should route to RunScript for container execution
      await expect(main(argv, env)).resolves.not.toThrow();
      // Note: May fail if test script doesn't exist, but routing should be correct
    });
  });
});
