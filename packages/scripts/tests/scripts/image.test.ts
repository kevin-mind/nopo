import { describe, it, vi, expect } from "vitest";
import compose from "docker-compose";
import ImageScript from "../../src/scripts/image";
import { createConfig } from "../../src/lib";
import { ParseEnv } from "../../src/parse-env";

import { createTmpEnv, runScript } from "../utils";

vi.mock("docker-compose", () => ({
  default: {
    pullOne: vi.fn(),
    buildOne: vi.fn(),
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

describe("image", () => {
  it("builds image when no DOCKER_REGISTRY is provided", async () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "kevin-mind/nopo:local",
      }),
      silent: true,
    });
    await runScript(ImageScript, config);
    const { env } = new ParseEnv(config);
    expect(compose.buildOne).toHaveBeenCalledWith("base", {
      log: true,
      commandOptions: [],
      config: ["docker/docker-compose.build.yml"],
      env: expect.objectContaining(env),
    });
  });

  it("builds image with builder", async () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "kevin-mind/nopo:local",
      }),
      processEnv: {
        DOCKER_BUILDER: "custom-builder",
      },
    });
    const { env } = new ParseEnv(config);
    await runScript(ImageScript, config);
    expect(compose.buildOne).toHaveBeenCalledWith("base", {
      log: true,
      commandOptions: ["--builder", "custom-builder"],
      config: ["docker/docker-compose.build.yml"],
      env: expect.objectContaining(env),
    });
  });

  it("pulls image when a registry is provided", async () => {
    const tmpEnv = createTmpEnv({
      DOCKER_TAG: "docker.io/kevin-mind/nopo:latest",
    });
    const config = createConfig({
      envFile: tmpEnv,
      processEnv: {},
      silent: true,
    });
    const { env } = new ParseEnv(config);
    expect(env.DOCKER_REGISTRY).toStrictEqual("docker.io");
    await runScript(ImageScript, config);
    expect(compose.pullOne).toHaveBeenCalledWith("base", {
      log: true,
      config: ["docker/docker-compose.base.yml"],
      commandOptions: ["--policy", "always"],
      env: expect.objectContaining(env),
    });
  });
});
