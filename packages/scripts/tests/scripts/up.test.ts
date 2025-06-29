import { describe, it, vi, expect } from "vitest";
import compose from "docker-compose";
import UpScript from "../../src/scripts/up";
import BuildScript from "../../src/scripts/build";
import PullScript from "../../src/scripts/pull";
import { createConfig } from "../../src/lib";
import { createTmpEnv, runScript } from "../utils";
import { Environment } from "../../src/parse-env";

vi.mock("../../src/scripts/build");
vi.mock("../../src/scripts/pull");

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

vi.mock("docker-compose", () => ({
  default: {
    config: vi.fn().mockImplementation(() => ({
      data: {
        config: {
          services: {},
        },
      },
    })),
    downMany: vi.fn(),
    upAll: vi.fn(),
    pullAll: vi.fn(),
    run: vi.fn(),
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

describe("up", () => {
  it("spins down services when image matches DOCKER_TAG", async () => {
    const localTag = "kevin-mind/nopo:local";
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: localTag,
      }),
      silent: true,
    });

    vi.mocked(compose.config).mockResolvedValue({
      data: {
        config: {
          volumes: {},
          services: {
            base: {
              image: localTag,
            },
          },
          version: {},
        },
      },
      exitCode: 0,
      out: "",
      err: "",
    });

    const { env } = new Environment(config);
    await runScript(UpScript, config);
    expect(compose.downMany).toHaveBeenCalledWith(["base"], {
      callback: expect.any(Function),
      commandOptions: ["--remove-orphans"],
      env: expect.objectContaining(env),
    });
  });
  it("spins up all services", async () => {
    const config = createConfig({
      envFile: createTmpEnv(),
      silent: true,
    });
    const { env } = new Environment(config);
    await runScript(UpScript, config);
    expect(compose.upAll).toHaveBeenCalledWith({
      callback: expect.any(Function),
      commandOptions: ["--remove-orphans", "-d", "--no-build", "--wait"],
      env: expect.objectContaining(env),
    });
  });
  it("syncs host files", async () => {
    const config = createConfig({
      envFile: createTmpEnv(),
      silent: true,
    });
    const { env } = new Environment(config);

    await runScript(UpScript, config);
    expect(compose.run).toHaveBeenCalledWith(
      "base",
      "/app/docker/sync-host.sh",
      {
        callback: expect.any(Function),
        config: ["docker/docker-compose.base.yml"],
        env: expect.objectContaining(env),
        commandOptions: ["--rm", "--no-deps"],
      },
    );
  });

  describe("dependencies", () => {
    it("has build dependency enabled for local images", async () => {
      const config = createConfig({
        envFile: createTmpEnv(),
        processEnv: {
          DOCKER_TAG: "local",
        },
        silent: true,
      });
      await runScript(UpScript, config);
      expect(BuildScript.prototype.fn).toHaveBeenCalled();
    });

    it("has pull dependency enabled for remote images", async () => {
      const config = createConfig({
        envFile: createTmpEnv(),
        processEnv: {
          DOCKER_TAG: "kevin-mind/nopo:1.0.0",
        },
        silent: true,
      });
      await runScript(UpScript, config);
      expect(PullScript.prototype.fn).toHaveBeenCalled();
    });

    it("enables build when DOCKER_BUILD is set", () => {
      const buildDep = UpScript.dependencies.find(
        (dep) => dep.class === BuildScript,
      );

      // Mock runner with DOCKER_BUILD set
      const forceBuilderRunner = {
        config: { processEnv: { DOCKER_BUILD: "true" } },
        environment: { env: { DOCKER_VERSION: "1.0.0" } },
      };

      if (buildDep && typeof buildDep.enabled === "function") {
        expect(buildDep.enabled(forceBuilderRunner)).toBe(true);
      }
    });
  });
});
