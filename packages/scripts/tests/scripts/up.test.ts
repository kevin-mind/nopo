import { describe, it, vi, expect } from "vitest";
import compose from "docker-compose";
import UpScript from "../../src/scripts/up.js";
import { Config } from "../../src/lib.js";
import { createTmpEnv, runScript } from "../utils.js";

vi.mock("docker-compose", () => ({
  default: {
    buildOne: vi.fn(),
    config: vi.fn(),
    downMany: vi.fn(),
    upAll: vi.fn(),
    rm: vi.fn(),
  },
}));

describe("image", () => {
  it("spins down services when image matches DOCKER_AG", async () => {
    const localTag = "kevin-mind/nopo:local";
    const config = new Config({
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

    await runScript(UpScript, config);
    expect(compose.downMany).toHaveBeenCalledWith(["base"], {
      log: true,
      commandOptions: ["--remove-orphans"],
    });
  });
  it("spins up all services", async () => {
    const config = new Config({
      envFile: createTmpEnv(),
      silent: true,
    });
    await runScript(UpScript, config);
    expect(compose.upAll).toHaveBeenCalledWith({
      log: true,
      commandOptions: ["--remove-orphans", "-d", "--no-build"],
    });
  });
  it("removes orphaned services", async () => {
    const config = new Config({
      envFile: createTmpEnv(),
      silent: true,
    });
    await runScript(UpScript, config);
    expect(compose.rm).toHaveBeenCalledWith({
      log: true,
      commandOptions: ["--force"],
    });
  });
});
