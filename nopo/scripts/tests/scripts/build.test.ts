import fs from "node:fs";
import { describe, it, vi, expect, beforeEach } from "vitest";
import BuildScript from "../../src/scripts/build.ts";

import {
  createTmpEnv,
  runScript,
  createTestConfig,
  createFixtureConfig,
} from "../utils.ts";

// Track all exec calls to docker for package builds
const mockExecCalls: Array<{ command: string; args: string[] }> = [];

// Mock the exec function from lib.ts for docker run commands
vi.mock("../../src/lib.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib.ts")>();
  return {
    ...original,
    exec: vi.fn((command: string, args: string[]) => {
      mockExecCalls.push({ command, args });
      return Promise.resolve({
        exitCode: 0,
        stdout: "",
        stderr: "",
        combined: "",
        signal: null,
      });
    }),
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
      // Verify NOPO_BASE_IMAGE is passed to service builds to resolve FROM correctly
      expect(bakeDefinition.target.backend.args.NOPO_BASE_IMAGE).toBe("root");
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
    it("builds packages via docker run with volume mounts", async () => {
      // Use fixture config which has packages with build commands
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "test/fixtures:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config);

      // Fixtures have packages with build.command configured
      const dockerRunCalls = mockExecCalls.filter(
        (call) => call.command === "docker" && call.args[0] === "run",
      );

      // Should have 2 docker run calls: shared and utils packages
      expect(dockerRunCalls).toHaveLength(2);

      // First call should be for 'shared' (dependency of 'utils')
      const sharedCall = dockerRunCalls[0];
      expect(sharedCall?.args).toContain("--rm");
      expect(sharedCall?.args).toContain("test/fixtures:local");
      expect(sharedCall?.args).toContain("sh");
      expect(sharedCall?.args).toContain("-c");
      expect(sharedCall?.args).toContain('echo "FIXTURE_SHARED_BUILD_SUCCESS"');

      // Second call should be for 'utils'
      const utilsCall = dockerRunCalls[1];
      expect(utilsCall?.args).toContain('echo "FIXTURE_UTILS_BUILD_SUCCESS"');
    });

    it("respects dependency ordering (dependencies built first)", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "test/fixtures:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config);

      const dockerRunCalls = mockExecCalls.filter(
        (call) => call.command === "docker" && call.args[0] === "run",
      );

      // 'shared' must be built before 'utils' since utils depends on shared
      const sharedIndex = dockerRunCalls.findIndex((call) =>
        call.args.includes('echo "FIXTURE_SHARED_BUILD_SUCCESS"'),
      );
      const utilsIndex = dockerRunCalls.findIndex((call) =>
        call.args.includes('echo "FIXTURE_UTILS_BUILD_SUCCESS"'),
      );

      expect(sharedIndex).toBeLessThan(utilsIndex);
    });

    it("sets correct UID/GID for file permissions", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "test/fixtures:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config);

      const dockerRunCalls = mockExecCalls.filter(
        (call) => call.command === "docker" && call.args[0] === "run",
      );

      // All calls should have -u with UID:GID
      for (const call of dockerRunCalls) {
        const userFlagIndex = call.args.indexOf("-u");
        expect(userFlagIndex).toBeGreaterThan(-1);
        expect(call.args[userFlagIndex + 1]).toBe("1001:1001");
      }
    });

    it("passes build environment variables to docker run", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "test/fixtures:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config);

      const dockerRunCalls = mockExecCalls.filter(
        (call) => call.command === "docker" && call.args[0] === "run",
      );

      // 'shared' package has build.env configured
      const sharedCall = dockerRunCalls.find((call) =>
        call.args.includes('echo "FIXTURE_SHARED_BUILD_SUCCESS"'),
      );

      expect(sharedCall?.args).toContain("-e");
      expect(sharedCall?.args).toContain("NODE_ENV=production");
    });

    it("does not build packages that lack build.command", async () => {
      mockBuilder.mockResolvedValue(null);
      const config = createTestConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "kevin-mind/nopo:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config);

      // No docker run calls should be made for packages without build.command
      const dockerRunCalls = mockExecCalls.filter(
        (call) => call.command === "docker" && call.args[0] === "run",
      );
      expect(dockerRunCalls).toHaveLength(0);
    });

    it("mounts project root as volume", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "test/fixtures:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config);

      const dockerRunCalls = mockExecCalls.filter(
        (call) => call.command === "docker" && call.args[0] === "run",
      );

      // All calls should have -v with project root mounted to /app
      for (const call of dockerRunCalls) {
        const volumeFlagIndex = call.args.indexOf("-v");
        expect(volumeFlagIndex).toBeGreaterThan(-1);
        const volumeValue = call.args[volumeFlagIndex + 1];
        expect(volumeValue).toMatch(/^.*:\/app$/);
      }
    });

    it("sets working directory to package path", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "test/fixtures:local",
        }),
        silent: true,
      });

      await runScript(BuildScript, config);

      const dockerRunCalls = mockExecCalls.filter(
        (call) => call.command === "docker" && call.args[0] === "run",
      );

      // Find call for 'shared' package
      const sharedCall = dockerRunCalls.find((call) =>
        call.args.includes('echo "FIXTURE_SHARED_BUILD_SUCCESS"'),
      );

      const wdFlagIndex = sharedCall?.args.indexOf("-w");
      expect(wdFlagIndex).toBeGreaterThan(-1);
      expect(sharedCall?.args[(wdFlagIndex ?? -1) + 1]).toBe(
        "/app/packages/shared",
      );
    });
  });

  describe("virtual Dockerfiles", () => {
    const baseTag = "kevin-mind/nopo:local";

    it("generates inline Dockerfile for services without physical Dockerfile", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "virtual"]);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      expect(bakeFilePath).toBeDefined();

      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      // Should have dockerfile_inline instead of dockerfile
      expect(bakeDefinition.target.virtual).toBeDefined();
      expect(bakeDefinition.target.virtual.dockerfile).toBeUndefined();
      expect(bakeDefinition.target.virtual.dockerfile_inline).toBeDefined();
    });

    it("includes build command in generated Dockerfile", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "virtual"]);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      const dockerfile = bakeDefinition.target.virtual.dockerfile_inline;
      expect(dockerfile).toContain('RUN echo "Building virtual package"');
    });

    it("includes OS packages in generated Dockerfile", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "virtual"]);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      const dockerfile = bakeDefinition.target.virtual.dockerfile_inline;
      expect(dockerfile).toContain("RUN apk add --no-cache curl");
    });

    it("includes build environment variables in generated Dockerfile", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "virtual"]);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      const dockerfile = bakeDefinition.target.virtual.dockerfile_inline;
      expect(dockerfile).toContain("ENV NODE_ENV=production");
      expect(dockerfile).toContain("ENV BUILD_FLAG=enabled");
    });

    it("generates per-output COPY statements in final stage", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "virtual"]);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      const dockerfile = bakeDefinition.target.virtual.dockerfile_inline;
      // Should have separate COPY for each output path
      expect(dockerfile).toContain("COPY --from=virtual-build");
      expect(dockerfile).toContain("${APP}/dist ${APP}/dist");
      expect(dockerfile).toContain("${APP}/lib ${APP}/lib");
    });

    it("generates correct build and final stage names", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "virtual"]);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      const dockerfile = bakeDefinition.target.virtual.dockerfile_inline;
      expect(dockerfile).toContain("FROM ${NOPO_BASE_IMAGE} AS virtual-build");
      expect(dockerfile).toContain("FROM ${NOPO_BASE_IMAGE} AS virtual");
    });

    it("sets SERVICE_NAME environment variable in final stage", async () => {
      const config = createFixtureConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "virtual"]);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      const dockerfile = bakeDefinition.target.virtual.dockerfile_inline;
      expect(dockerfile).toContain("ENV SERVICE_NAME=${SERVICE_NAME}");
    });
  });
});
