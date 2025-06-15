import { describe, it, vi, expect } from "vitest";
import compose from "docker-compose";
import UpScript from "../../src/scripts/up";
import { createConfig } from "../../src/lib";
import { createTmpEnv, runScript } from "../utils";
import { ParseEnv } from "../../src/parse-env";

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
    buildOne: vi.fn(),
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

describe("image", () => {
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

    const { env } = new ParseEnv(config);
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
    const { env } = new ParseEnv(config);
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
    const { env } = new ParseEnv(config);

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
});
