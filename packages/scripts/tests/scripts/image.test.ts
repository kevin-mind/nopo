import { describe, it, vi, expect } from "vitest";
import compose from "docker-compose";
import ImageScript from "../../src/scripts/image";
import { Config } from "../../src/lib";
import { ParseEnv } from "../../src/parse-env";

import { createTmpEnv, runScript } from "../utils";

vi.mock("docker-compose", () => ({
  default: {
    pullOne: vi.fn(),
    buildOne: vi.fn(),
  },
}));

describe("image", () => {
  it("builds image when no DOCKER_REGISTRY is provided", async () => {
    const config = new Config({
      envFile: createTmpEnv({
        DOCKER_TAG: "kevin-mind/nopo:local",
      }),
      silent: true,
    });
    await runScript(ImageScript, config);
    const { env } = new ParseEnv(config.envFile);
    expect(compose.buildOne).toHaveBeenCalledWith("base", {
      log: true,
      cwd: config.root,
      env: {
        ...config.processEnv,
        ...env,
        COMPOSE_BAKE: "true",
      },
    });
  });

  it("pulls image when a registry is provided", async () => {
    const tmpEnv = createTmpEnv({
      DOCKER_TAG: "docker.io/kevin-mind/nopo:latest",
    });
    const config = new Config({
      envFile: tmpEnv,
      processEnv: {},
      silent: true,
    });
    const { env } = new ParseEnv(config.envFile);
    expect(env.DOCKER_REGISTRY).toStrictEqual("docker.io");
    await runScript(ImageScript, config);
    expect(compose.pullOne).toHaveBeenCalledWith("base", {
      log: true,
      commandOptions: ["--policy", "always"],
    });
  });
});
