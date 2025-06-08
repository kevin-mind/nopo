import { describe, it, expect } from "vitest";
import fs from "node:fs";

import EnvScript from "../../src/scripts/env";
import { ParseEnv } from "../../src/parse-env";
import { Config } from "../../src/lib";

import { createTmpEnv, runScript, dockerTag } from "../utils.js";
import path from "node:path";

/*
1. DOCKER_TAG is the ONLY input parameter
2. env will parse DOCKER_TAG into registry, image, version, and digest (depending on the tag)
3. it will save the values as well as additional values for the environment to the .env file
4. it will validate the docker tag is valid
5. it will validate environment variables are valid against docker tag
6. it will log values that are added,updated,removed, and unchanged accordingly

QUESTION: We could consider allowing "stateful" input where if you set the value with DOCKER_TAG and then set again partial DOCKER_TAG to use the previous tag as the partial. THis is a bad idea as thi stuff get's really complicated and hard to reason about. User's should be smart enough to provide valid docker tags.
*/

describe("env", () => {
  it("prioritiszes file input over base tag", async () => {
    const testEnv = createTmpEnv({ DOCKER_TAG: dockerTag.fullTag });
    const config = new Config({
      envFile: testEnv,
      processEnv: {},
      silent: true,
    });
    await runScript(EnvScript, config);
    const { env } = new ParseEnv(config.envFile);
    expect(env.DOCKER_TAG).toStrictEqual(dockerTag.fullTag);
  });

  it("prioritizes environment over file input", async () => {
    const testEnv = createTmpEnv({ DOCKER_TAG: dockerTag.fullTag });
    const config = new Config({
      envFile: testEnv,
      processEnv: { DOCKER_TAG: "registry/repo:tag" },
      silent: true,
    });

    await runScript(EnvScript, config);
    const { env } = new ParseEnv(config.envFile);
    expect(env.DOCKER_TAG).toStrictEqual("registry/repo:tag");
  });

  it("extracts docker tag components from DOCKER_TAG", async () => {
    const testEnv = createTmpEnv({ DOCKER_TAG: dockerTag.fullTag });
    const config = new Config({
      envFile: testEnv,
      processEnv: {},
      silent: true,
    });
    await runScript(EnvScript, config);
    const { env } = new ParseEnv(config.envFile);
    expect(env.DOCKER_REGISTRY).toStrictEqual(dockerTag.parsed.registry);
    expect(env.DOCKER_IMAGE).toStrictEqual(dockerTag.parsed.image);
    expect(env.DOCKER_VERSION).toStrictEqual(dockerTag.parsed.version);
    expect(env.DOCKER_DIGEST).toStrictEqual(dockerTag.parsed.digest);
  });

  describe("error states", () => {
    it("throws error when digest is specified without version", async () => {
      const config = new Config({
        envFile: createTmpEnv(),
        processEnv: {
          DOCKER_TAG: `@${dockerTag.parsed.digest}`,
        },
        silent: true,
      });
      await expect(runScript(EnvScript, config)).rejects.toThrow(
        "Invalid image tag",
      );
    });

    it("throws error for invalid DOCKER_TAG input", async () => {
      const config = new Config({
        envFile: createTmpEnv(),
        processEnv: {
          DOCKER_TAG: "@?sdflkj2",
        },
        silent: true,
      });
      await expect(runScript(EnvScript, config)).rejects.toThrow(
        "Invalid image tag",
      );
    });

    it("Corrects invalid NODE_ENV to default on remote images", async () => {
      const config = new Config({
        envFile: createTmpEnv(),
        processEnv: {
          NODE_ENV: "invalid",
          DOCKER_TAG: dockerTag.fullTag,
        },
        silent: true,
      });
      await runScript(EnvScript, config);
      const { env } = new ParseEnv(config.envFile);
      // Default for dockerTag is production since this is a remote image
      expect(env.NODE_ENV).toStrictEqual("production");
    });

    it("Corrects invalid DOCKER_TARGET to default on remote images", async () => {
      const config = new Config({
        envFile: createTmpEnv(),
        processEnv: {
          DOCKER_TARGET: "invalid",
          DOCKER_TAG: dockerTag.fullTag,
        },
        silent: true,
      });
      await runScript(EnvScript, config);
      const { env } = new ParseEnv(config.envFile);
      expect(env.DOCKER_TARGET).toStrictEqual("production");
    });
  });

  describe("defaults and inference", () => {
    it("uses default .env file when none is provided", async () => {
      const config = new Config({
        envFile: undefined,
        processEnv: {},
        silent: true,
      });
      await runScript(EnvScript, config);
      expect(config.envFile).toStrictEqual(path.resolve(config.root, ".env"));
    });

    it('sets missing NODE_ENV and DOCKER_TARGET to "development" for local images', async () => {
      const config = new Config({
        envFile: createTmpEnv(),
        processEnv: {
          DOCKER_TAG: "kevin-mind/nopo:local",
        },
        silent: true,
      });
      await runScript(EnvScript, config);
      const { env } = new ParseEnv(config.envFile);
      expect(env.NODE_ENV).toStrictEqual("development");
      expect(env.DOCKER_TARGET).toStrictEqual("development");
    });

    it("sets HOST_UID to current process UID by default", async () => {
      const config = new Config({
        envFile: createTmpEnv(),
        processEnv: {
          DOCKER_TAG: dockerTag.fullTag,
        },
        silent: true,
      });
      await runScript(EnvScript, config);
      const { env } = new ParseEnv(config.envFile);
      expect(env.HOST_UID).toStrictEqual(process.getuid?.()?.toString());
    });

    it("uses base tag when no DOCKER_TAG is provided", async () => {
      const tmpFile = createTmpEnv();
      const config = new Config({
        envFile: tmpFile,
        processEnv: {},
        silent: true,
      });
      await runScript(EnvScript, config);
      const { env } = new ParseEnv(config.envFile);
      expect(env.DOCKER_TAG).toStrictEqual(ParseEnv.baseTag.fullTag);
    });
  });

  describe("file operations", () => {
    it("creates new .env file when none exists", async () => {
      const tmpFile = createTmpEnv();
      fs.rmSync(tmpFile);
      const config = new Config({
        envFile: tmpFile,
        processEnv: {},
        silent: true,
      });
      await runScript(EnvScript, config);
      expect(fs.existsSync(tmpFile)).toBe(true);
    });

    it("updates existing .env file with new values", async () => {
      const tmpFile = createTmpEnv({
        DOCKER_TAG: dockerTag.fullTag,
        NODE_ENV: "production",
      });
      const config = new Config({
        envFile: tmpFile,
        processEnv: {},
        silent: true,
      });
      const { env: prevEnv } = new ParseEnv(tmpFile);
      await runScript(EnvScript, config);
      const { env: newEnv } = new ParseEnv(tmpFile);
      expect(newEnv.DOCKER_TAG).toStrictEqual(prevEnv.DOCKER_TAG);
      expect(newEnv.NODE_ENV).toStrictEqual(prevEnv.NODE_ENV);
    });

    it("sorts environment variables alphabetically in output file", async () => {
      const tmpFile = createTmpEnv();
      const config = new Config({
        envFile: tmpFile,
        processEnv: {},
        silent: true,
      });
      await runScript(EnvScript, config);
      const str = fs.readFileSync(tmpFile, "utf8");
      const actualKeys = str.split("\n").map((line) => line.split("=")[0]);
      const sortedKeys = [...actualKeys].sort();
      expect(actualKeys).toStrictEqual(sortedKeys);
    });

    it('formats output as KEY="value" pairs', async () => {
      const tmpFile = createTmpEnv();
      const config = new Config({
        envFile: tmpFile,
        processEnv: {
          NODE_ENV: "production",
        },
        silent: true,
      });
      await runScript(EnvScript, config);
      const str = fs.readFileSync(tmpFile, "utf8");
      expect(str).toContain('NODE_ENV="production"');
    });
  });
});
