import { describe, it, expect } from "vitest";
import { tmpfile, dotenv } from "zx";

import { parseEnv } from "../src/parse-env";

const DOCKER_DIGEST =
  "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

function createTmpEnv(env = {}) {
  const str = dotenv.stringify(env);
  const tmpPath = tmpfile("env", str);
  return tmpPath;
}

describe("parseEnv", () => {
  it("should parse the env", () => {
    const env = parseEnv(createTmpEnv());
    expect(env).toMatchSnapshot();
  });

  it("should override from file", () => {
    const env = parseEnv(
      createTmpEnv({
        NODE_ENV: "production",
      }),
      {},
    );
    expect(env.NODE_ENV).toBe("production");
  });

  it("should override from process", () => {
    const env = parseEnv(
      createTmpEnv({
        NODE_ENV: "production",
      }),
      {
        NODE_ENV: "development",
      },
    );
    expect(env.NODE_ENV).toBe("development");
  });

  it("rejects invalid NODE_ENV", () => {
    expect(() => parseEnv(undefined, { NODE_ENV: "invalid" })).toThrow();
  });

  it("rejects invalid DOCKER_TARGET", () => {
    expect(() => parseEnv(undefined, { DOCKER_TARGET: "invalid" })).toThrow();
  });

  it("should use provided DOCKER_TAG if present", () => {
    const env = parseEnv(undefined, {
      DOCKER_TAG: "docker.io/custom/image:1.0.0",
    });
    expect(env.DOCKER_TAG).toBe("docker.io/custom/image:1.0.0");
    expect(env.DOCKER_REGISTRY).toBe("docker.io");
    expect(env.DOCKER_IMAGE).toBe("custom/image");
    expect(env.DOCKER_VERSION).toBe("1.0.0");
  });

  it("should not construct tag from components if DOCKER_TAG not present", () => {
    const env = parseEnv(undefined, {
      DOCKER_REGISTRY: "quay.io",
      DOCKER_IMAGE: "custom/image",
      DOCKER_VERSION: "2.0.0",
    });
    expect(env.DOCKER_TAG).toBe("docker.io/mozilla/addons-server:local");
  });

  it("should use base tag when no docker config provided", () => {
    const env = parseEnv(undefined, {});
    expect(env.DOCKER_TAG).toBe("docker.io/mozilla/addons-server:local");
  });

  it("should force production target for non-local image", () => {
    const env = parseEnv(undefined, {
      DOCKER_TAG: "docker.io/mozilla/addons-server:1.0.0",
      DOCKER_TARGET: "development",
    });
    expect(env.DOCKER_TARGET).toBe("production");
  });

  it.each(["development", "production"])(
    "should allow either target for local image",
    (target) => {
      const env = parseEnv(undefined, {
        DOCKER_TAG: "docker.io/mozilla/addons-server:local",
        DOCKER_TARGET: target,
      });
      expect(env.DOCKER_TARGET).toBe(target);
    },
  );

  it("should throw error when digest provided without version", () => {
    expect(() =>
      parseEnv(undefined, {
        DOCKER_TAG: `@sha256:${DOCKER_DIGEST}`,
      }),
    ).toThrow("Invalid image tag: ");
  });

  it("should handle version-only input correctly", () => {
    const env = parseEnv(undefined, {
      DOCKER_TAG: "3.0.0",
    });
    expect(env.DOCKER_TAG).toBe("docker.io/mozilla/addons-server:3.0.0");
  });

  it("should handle version and digest input correctly", () => {
    const env = parseEnv(undefined, {
      DOCKER_TAG: `1.0.0@sha256:${DOCKER_DIGEST}`,
    });
    expect(env.DOCKER_TAG).toBe(
      `docker.io/mozilla/addons-server:1.0.0@sha256:${DOCKER_DIGEST}`,
    );
  });

  it("should handle image-only input correctly", () => {
    const env = parseEnv(undefined, {
      DOCKER_TAG: "custom/image:1.0.0",
    });
    expect(env.DOCKER_TAG).toBe("docker.io/custom/image:1.0.0");
  });
});
