import { describe, it, vi, expect, beforeEach } from "vitest";
import BuildScript from "../../src/scripts/build";
import { createConfig } from "../../src/lib";

import { createTmpEnv, runScript } from "../utils";

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

describe("build", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds image with default options", async () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "kevin-mind/nopo:local",
      }),
      silent: true,
    });

    await runScript(BuildScript, config);

    expect(mockBake).toHaveBeenCalledWith(
      "-f",
      "docker/docker-bake.hcl",
      "-f",
      config.envFile,
      "--debug",
      "--progress=plain",
      "--load",
      "--print",
    );
    expect(mockBake).toHaveBeenCalledWith(
      "-f",
      "docker/docker-bake.hcl",
      "-f",
      config.envFile,
      "--debug",
      "--progress=plain",
      "--load",
    );
  });

  it("builds image with custom builder", async () => {
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

    expect(mockBake).toHaveBeenCalledWith(
      "-f",
      "docker/docker-bake.hcl",
      "-f",
      config.envFile,
      "--debug",
      "--progress=plain",
      "--builder",
      "custom-builder",
      "--load",
      "--print",
    );
    expect(mockBake).toHaveBeenCalledWith(
      "-f",
      "docker/docker-bake.hcl",
      "-f",
      config.envFile,
      "--debug",
      "--progress=plain",
      "--builder",
      "custom-builder",
      "--load",
    );
  });

  it("pushes image when DOCKER_PUSH is set", async () => {
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

    expect(mockBake).toHaveBeenCalledWith(
      "-f",
      "docker/docker-bake.hcl",
      "-f",
      config.envFile,
      "--debug",
      "--progress=plain",
      "--push",
      "--print",
    );
    expect(mockBake).toHaveBeenCalledWith(
      "-f",
      "docker/docker-bake.hcl",
      "-f",
      config.envFile,
      "--debug",
      "--progress=plain",
      "--push",
    );
  });

  it("has correct dependencies", () => {
    expect(BuildScript.dependencies).toHaveLength(1);
    expect(BuildScript.dependencies[0].enabled).toBe(true);
  });
});
