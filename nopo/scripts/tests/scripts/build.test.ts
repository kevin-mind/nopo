import fs from "node:fs";
import { describe, it, vi, expect, beforeEach } from "vitest";
import BuildScript from "../../src/scripts/build.ts";
import { createConfig } from "../../src/lib.ts";

import { createTmpEnv, runScript } from "../utils.ts";

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
    BuildScript.prototype.builder = mockBuilder;
  });

  it("builds all targets with default options", async () => {
    mockBuilder.mockResolvedValue("default");
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "kevin-mind/nopo:local",
      }),
      silent: true,
    });

    await runScript(BuildScript, config);

    expect(mockBake).toHaveBeenCalledTimes(2);

    const firstCall = mockBake.mock.calls[0];
    expect(firstCall).toContain("--print");
    expect(firstCall).toContain("--builder");
    expect(firstCall).toContain("default");

    const secondCall = mockBake.mock.calls[1];
    expect(secondCall).not.toContain("--print");
    expect(secondCall).toContain("--builder");
    expect(secondCall).toContain("default");

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
    expect(bakeDefinition.target.base.output).toEqual(["type=docker"]);
  });

  it("builds with custom builder", async () => {
    mockBuilder.mockResolvedValue("custom-builder");
    const config = createConfig({
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
    const config = createConfig({
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

    it("builds only base when specified", async () => {
      const config = createConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });

      await runScript(BuildScript, config, ["build", "base"]);

      const bakeFilePath = mockBake?.mock.calls?.[0]?.find((arg: string) =>
        arg.endsWith("docker-bake.json"),
      );
      expect(bakeFilePath).toBeDefined();

      const bakeContent = fs.readFileSync(bakeFilePath, "utf-8");
      const bakeDefinition = JSON.parse(bakeContent);

      expect(bakeDefinition.group.default.targets).toEqual(["base"]);
      expect(bakeDefinition.target.base).toBeDefined();
      expect(bakeDefinition.target.backend).toBeUndefined();
      expect(bakeDefinition.target.web).toBeUndefined();
    });

    it("builds service with base as dependency", async () => {
      const config = createConfig({
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
      expect(bakeDefinition.target.base).toBeDefined();
      expect(bakeDefinition.target.backend).toBeDefined();
      expect(bakeDefinition.target.backend.contexts).toEqual({
        base: "target:base",
      });
    });

    it("builds multiple services in parallel", async () => {
      const config = createConfig({
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
      expect(bakeDefinition.target.base).toBeDefined();
      expect(bakeDefinition.target.backend).toBeDefined();
      expect(bakeDefinition.target.web).toBeDefined();
    });

    it("throws error for unknown target", async () => {
      const config = createConfig({
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
      const config = createConfig({
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
      const config = createConfig({
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
});
