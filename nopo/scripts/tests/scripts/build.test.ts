import fs from "node:fs";
import { describe, it, vi, expect, beforeEach } from "vitest";
import BuildScript from "../../src/scripts/build.ts";

import {
  createTmpEnv,
  runScript,
  createTestConfig,
  createFixtureConfig,
} from "../utils.ts";

// Track all exec calls for package builds
const mockExecCalls: Array<{
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}> = [];

// Mock the exec function from lib.ts for docker run commands
vi.mock("../../src/lib.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib.ts")>();
  return {
    ...original,
    exec: vi.fn(
      (
        command: string,
        args: string[],
        options?: { cwd?: string; env?: Record<string, string> },
      ) => {
        mockExecCalls.push({
          command,
          args,
          cwd: options?.cwd,
          env: options?.env,
        });
        return Promise.resolve({
          exitCode: 0,
          stdout: "",
          stderr: "",
          combined: "",
          signal: null,
        });
      },
    ),
  };
});

vi.mock("../../src/git-info", () => ({
  GitInfo: {
    exists: () => false,
    parse: vi.fn(() => ({
      repo: "unknown",
      branch: "unknown",
      commit: "unknown",
    })),
  },
}));

vi.mock("node:net", () => ({
  default: {
    createServer: vi.fn().mockImplementation(() => ({
      listen: vi.fn(),
      address: vi.fn().mockReturnValue({ port: 80 }),
      close: vi.fn(),
    })),
  },
}));

// Mock the bake method directly on the prototype
const mockBake = vi.fn().mockResolvedValue(undefined);
BuildScript.prototype.bake = mockBake;

const mockBuilder = vi.fn().mockResolvedValue("nopo-builder");

describe("build", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecCalls.length = 0;
    BuildScript.prototype.builder = mockBuilder;
  });

  it("builds all targets with default options (local development)", async () => {
    // Local development returns null builder to use current context's default
    mockBuilder.mockResolvedValue(null);
    const config = createTestConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "kevin-mind/nopo:local",
      }),
      silent: true,
    });

    await runScript(BuildScript, config);

    expect(mockBake).toHaveBeenCalledTimes(2);

    const firstCall = mockBake.mock.calls[0];
    expect(firstCall).toContain("--print");
    // Should NOT contain --builder when builder is null (local development)
    expect(firstCall).not.toContain("--builder");

    const secondCall = mockBake.mock.calls[1];
    expect(secondCall).not.toContain("--print");
    // Should NOT contain --builder when builder is null (local development)
    expect(secondCall).not.toContain("--builder");

    // Verify bake file is used in both calls
    expect(
      firstCall?.some((arg: string) => arg.endsWith("docker-bake.json")),
    ).toBe(true);
    expect(
      secondCall?.some((arg: string) => arg.endsWith("docker-bake.json")),
    ).toBe(true);

    // Verify the bake definition uses type=docker output for local builds
    const bakeFilePath = firstCall?.find((arg: string) =>
      arg.endsWith("docker-bake.json"),
    );
    expect(bakeFilePath).toBeDefined();

    const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
    const bakeDefinition = JSON.parse(bakeContent);

    // For local builds (no push), output should be type=docker
    expect(bakeDefinition.target.root.output).toEqual(["type=docker"]);
  });

  it("builds with custom builder", async () => {
    mockBuilder.mockResolvedValue("custom-builder");
    const config = createTestConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "kevin-mind/nopo:local",
      }),
      processEnv: {
        DOCKER_BUILDER: "custom-builder",
      },
      silent: true,
    });

    await runScript(BuildScript, config);

    expect(mockBake.mock.calls[0]).toContain("custom-builder");
    expect(mockBake.mock.calls[1]).toContain("custom-builder");
  });

  it("pushes images when DOCKER_PUSH is set", async () => {
    mockBuilder.mockResolvedValue("nopo-builder");
    const config = createTestConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "kevin-mind/nopo:local",
      }),
      processEnv: {
        DOCKER_PUSH: "true",
      },
      silent: true,
    });

    await runScript(BuildScript, config);

    expect(mockBake.mock.calls[0]).toContain("--push");
    expect(mockBake.mock.calls[1]).toContain("--push");
  });

  it("has correct dependencies", () => {
    expect(BuildScript.dependencies).toHaveLength(1);
    expect(BuildScript.dependencies[0]?.enabled).toBe(true);
  });

  describe("target selection", () => {
    const baseTag = "kevin-mind/nopo:local";

    it("builds only root when specified", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "root"]);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      expect(bakeFilePath).toBeDefined();

      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      expect(bakeDefinition.group.default.targets).toEqual(["root"]);
      expect(bakeDefinition.target.root).toBeDefined();
      expect(bakeDefinition.target.backend).toBeUndefined();
      expect(bakeDefinition.target.web).toBeUndefined();
    });

    it("builds service with root as dependency", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "backend"]);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      expect(bakeDefinition.group.default.targets).toEqual(["backend"]);
      expect(bakeDefinition.target.root).toBeDefined();
      expect(bakeDefinition.target.backend).toBeDefined();
      expect(bakeDefinition.target.backend.contexts).toEqual({
        root: "target:root",
      });
      // Virtual Dockerfile uses context name directly instead of NOPO_BASE_IMAGE arg
      expect(bakeDefinition.target.backend["dockerfile-inline"]).toBeDefined();
      expect(bakeDefinition.target.backend.args.SERVICE_NAME).toBe("backend");
    });

    it("builds multiple services in parallel", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "backend", "web"]);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      expect(bakeDefinition.group.default.targets).toEqual(["backend", "web"]);
      expect(bakeDefinition.target.root).toBeDefined();
      expect(bakeDefinition.target.backend).toBeDefined();
      expect(bakeDefinition.target.web).toBeDefined();
    });

    it("throws error for unknown target", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });

      await expect(
        runScript(BuildScript, config, ["build", "unknown-service"]),
      ).rejects.toThrow("Unknown target 'unknown-service'");
    });

    it("records service image tags in environment", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "backend"]);

      const envContents = fs.readFileSync(config.envFile, "utf-8");
      expect(envContents).toContain(
        'BACKEND_IMAGE="kevin-mind/nopo-backend:local"',
      );
    });
  });

  describe("no-cache option", () => {
    it("passes --no-cache to bake", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "--no-cache"]);

      expect(mockBake.mock.calls[0]).toContain("--no-cache");
      expect(mockBake.mock.calls[1]).toContain("--no-cache");
    });
  });

  describe("multi-platform builds", () => {
    it("includes platforms when DOCKER_PUSH is set", async () => {
      mockBuilder.mockResolvedValue("nopo-builder");
      const config = createTestConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
        processEnv: {
          DOCKER_PUSH: "true",
        },
        silent: true,
      });

      await runScript(BuildScript, config);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      expect(bakeFilePath).toBeDefined();

      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      // When pushing, platforms should be set to default multi-arch
      expect(bakeDefinition.target.root.platforms).toEqual([
        "linux/amd64",
        "linux/arm64",
      ]);
      expect(bakeDefinition.target.backend.platforms).toEqual([
        "linux/amd64",
        "linux/arm64",
      ]);
    });

    it("does not include platforms for local builds", async () => {
      // Local development returns null builder to use current context's default
      mockBuilder.mockResolvedValue(null);
      const config = createTestConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      expect(bakeFilePath).toBeDefined();

      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      // For local builds, platforms should not be set (Docker type=docker doesn't support multi-platform)
      expect(bakeDefinition.target.root.platforms).toBeUndefined();
      expect(bakeDefinition.target.backend.platforms).toBeUndefined();
    });

    it("allows overriding platforms via DOCKER_PLATFORMS env var", async () => {
      mockBuilder.mockResolvedValue("nopo-builder");
      const config = createTestConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
        processEnv: {
          DOCKER_PUSH: "true",
          DOCKER_PLATFORMS: "linux/amd64",
        },
        silent: true,
      });

      await runScript(BuildScript, config);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      expect(bakeFilePath).toBeDefined();

      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      // Custom platforms should override the default
      expect(bakeDefinition.target.root.platforms).toEqual(["linux/amd64"]);
      expect(bakeDefinition.target.backend.platforms).toEqual(["linux/amd64"]);
    });

    it("handles multiple custom platforms with spaces", async () => {
      mockBuilder.mockResolvedValue("nopo-builder");
      const config = createTestConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
        processEnv: {
          DOCKER_PUSH: "true",
          DOCKER_PLATFORMS: "linux/amd64, linux/arm64, linux/arm/v7",
        },
        silent: true,
      });

      await runScript(BuildScript, config);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      expect(bakeFilePath).toBeDefined();

      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      // Platforms should be trimmed and parsed correctly
      expect(bakeDefinition.target.root.platforms).toEqual([
        "linux/amd64",
        "linux/arm64",
        "linux/arm/v7",
      ]);
    });
  });

  describe("package builds", () => {
    it("builds packages on host with build.command", async () => {
      // Use fixture config which has packages with build commands
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "test/fixtures:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config);

      const packageBuildCalls = mockExecCalls.filter(
        (call) => call.command === "sh" && call.args[0] === "-c",
      );

      // Should have 3 host calls: shared, utils, and virtual packages
      expect(packageBuildCalls).toHaveLength(3);

      // First call should be for 'shared' (dependency of 'utils')
      const sharedCall = packageBuildCalls[0];
      expect(sharedCall?.args).toEqual([
        "-c",
        'echo "FIXTURE_SHARED_BUILD_SUCCESS"',
      ]);

      // Second call should be for 'utils'
      const utilsCall = packageBuildCalls[1];
      expect(utilsCall?.args).toEqual([
        "-c",
        'echo "FIXTURE_UTILS_BUILD_SUCCESS"',
      ]);

      // Third call should be for 'virtual'
      const virtualCall = packageBuildCalls[2];
      expect(virtualCall?.args).toEqual([
        "-c",
        'echo "Building virtual package"',
      ]);
    });

    it("respects dependency ordering (dependencies built first)", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "test/fixtures:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config);

      const packageBuildCalls = mockExecCalls.filter(
        (call) => call.command === "sh" && call.args[0] === "-c",
      );

      // 'shared' must be built before 'utils' since utils depends on shared
      const sharedIndex = packageBuildCalls.findIndex((call) =>
        call.args.includes('echo "FIXTURE_SHARED_BUILD_SUCCESS"'),
      );
      const utilsIndex = packageBuildCalls.findIndex((call) =>
        call.args.includes('echo "FIXTURE_UTILS_BUILD_SUCCESS"'),
      );

      expect(sharedIndex).toBeLessThan(utilsIndex);
    });

    it("runs package builds from the package directory", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "test/fixtures:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config);

      const packageBuildCalls = mockExecCalls.filter(
        (call) => call.command === "sh" && call.args[0] === "-c",
      );

      expect(
        packageBuildCalls.some((call) =>
          call.cwd?.endsWith("/packages/shared"),
        ),
      ).toBe(true);
      expect(
        packageBuildCalls.some((call) => call.cwd?.endsWith("/packages/utils")),
      ).toBe(true);
      expect(
        packageBuildCalls.some((call) =>
          call.cwd?.endsWith("/packages/virtual"),
        ),
      ).toBe(true);
    });

    it("passes build environment variables to host package build", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "test/fixtures:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config);

      const packageBuildCalls = mockExecCalls.filter(
        (call) => call.command === "sh" && call.args[0] === "-c",
      );

      // 'shared' package has build.env configured
      const sharedCall = packageBuildCalls.find((call) =>
        call.args.includes('echo "FIXTURE_SHARED_BUILD_SUCCESS"'),
      );

      expect(sharedCall?.env?.NODE_ENV).toBe("production");
    });

    it("does not attempt to build packages without build.command", async () => {
      mockBuilder.mockResolvedValue(null);
      const config = createTestConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "backend"]);

      // Building a service target should not try to build package-only targets
      // that don't define build.command (e.g., packages/ui)
      const uiBuildCalls = mockExecCalls.filter((call) =>
        call.cwd?.endsWith("/packages/ui"),
      );
      expect(uiBuildCalls).toHaveLength(0);
    });

    it("throws for targeted package without build.command", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
        silent: true,
      });

      await expect(
        runScript(BuildScript, config, ["build", "prompt-factory"]),
      ).rejects.toThrow(
        "Package 'prompt-factory' cannot be built because it does not define build.command",
      );
    });

    it("does not invoke docker bake for package-only targets", async () => {
      const config = createTestConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "claude"]);

      expect(mockBake).toHaveBeenCalledTimes(0);
    });

    it("builds only packages matching --tags", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "test/fixtures:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "--tags", "fixture-tag"]);

      const packageBuildCalls = mockExecCalls.filter(
        (call) => call.command === "sh" && call.args[0] === "-c",
      );
      expect(packageBuildCalls).toHaveLength(2);
      const sharedIndex = packageBuildCalls.findIndex((call) =>
        call.args.includes('echo "FIXTURE_SHARED_BUILD_SUCCESS"'),
      );
      const utilsIndex = packageBuildCalls.findIndex((call) =>
        call.args.includes('echo "FIXTURE_UTILS_BUILD_SUCCESS"'),
      );
      expect(sharedIndex).toBeGreaterThanOrEqual(0);
      expect(utilsIndex).toBeGreaterThanOrEqual(0);
      expect(sharedIndex).toBeLessThan(utilsIndex);
      expect(mockBake).toHaveBeenCalledTimes(0);
    });
  });
});
