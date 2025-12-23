import fs from "node:fs";
import path from "node:path";
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
      "nopo/docker/docker-bake.hcl",
      "-f",
      config.envFile,
      "--debug",
      "--progress=plain",
      "--builder",
      "nopo-builder",
      "--load",
      "--print",
    );
    expect(mockBake).toHaveBeenCalledWith(
      "-f",
      "nopo/docker/docker-bake.hcl",
      "-f",
      config.envFile,
      "--debug",
      "--progress=plain",
      "--builder",
      "nopo-builder",
      "--load",
    );
  });

  it("builds image with custom builder", async () => {
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

    expect(mockBake).toHaveBeenCalledWith(
      "-f",
      "nopo/docker/docker-bake.hcl",
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
      "nopo/docker/docker-bake.hcl",
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

    expect(mockBake).toHaveBeenCalledWith(
      "-f",
      "nopo/docker/docker-bake.hcl",
      "-f",
      config.envFile,
      "--debug",
      "--progress=plain",
      "--builder",
      "nopo-builder",
      "--load",
      "--push",
      "--print",
    );
    expect(mockBake).toHaveBeenCalledWith(
      "-f",
      "nopo/docker/docker-bake.hcl",
      "-f",
      config.envFile,
      "--debug",
      "--progress=plain",
      "--builder",
      "nopo-builder",
      "--load",
      "--push",
    );
  });

  it("has correct dependencies", () => {
    expect(BuildScript.dependencies).toHaveLength(1);
    expect(BuildScript.dependencies[0]?.enabled).toBe(true);
  });

  describe("service builds", () => {
    const baseTag = "kevin-mind/nopo:local";

    function mockExec() {
      const calls: string[] = [];

      const execSpy = vi
        .spyOn(
          BuildScript.prototype as unknown as Record<string, unknown>,
          "exec",
          "get",
        )
        .mockReturnValue(
          (strings: TemplateStringsArray, ...values: unknown[]) => {
            const raw = strings.reduce((acc, chunk, index) => {
              const value = index < values.length ? String(values[index]) : "";
              return acc + chunk + value;
            }, "");
            const normalized = raw.replace(/\s+/g, " ").trim();
            calls.push(normalized);
            const stdout = normalized.includes("/build-info.json")
              ? JSON.stringify({ tag: baseTag })
              : "";
            return Promise.resolve({ stdout } as { stdout: string });
          },
        );
      return { execSpy, calls };
    }

    it("builds service dockerfile and records image tag", async () => {
      const config = createConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });
      const { execSpy, calls } = mockExec();

      await runScript(BuildScript, config, ["build", "--service", "backend"]);

      execSpy.mockRestore();

      const dockerfile = path.join(
        config.root,
        "apps",
        "backend",
        "Dockerfile",
      );

      expect(
        calls.some((command) =>
          command.includes(
            `docker build --file ${dockerfile} --build-arg NOPO_BASE_IMAGE=${baseTag}`,
          ),
        ),
      ).toBe(true);

      const envContents = fs.readFileSync(config.envFile, "utf-8");
      expect(envContents).toContain(
        'BACKEND_IMAGE="kevin-mind/nopo-backend:local"',
      );
    });

    it("requires a service name when using --dockerFile", async () => {
      const config = createConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: baseTag,
        }),
        silent: true,
      });

      await expect(
        runScript(BuildScript, config, [
          "build",
          "--dockerFile",
          "apps/backend/Dockerfile",
        ]),
      ).rejects.toThrow("--dockerFile can only be used");
    });
  });
});
