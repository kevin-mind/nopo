import { describe, it, expect } from "vitest";
import { tmpfile, dotenv } from "zx";

import { parseEnv } from "../src/parse-env";

const DOCKER_DIGEST =
  "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

function createTmpEnv(env = {}) {
  const str = dotenv.stringify(env);
  const tmpPath = tmpfile("env", str);
  return tmpPath;
}

describe("parseEnv", () => {
  it("should parse the env", () => {
    const env = parseEnv(createTmpEnv());
    env.meta.path = "test"; // override so snapshot is deterministic
    expect(env).toMatchSnapshot();
  });

  it("should override from file", () => {
    const { data } = parseEnv(
      createTmpEnv({
        NODE_ENV: "production",
      }),
      {},
    );
    expect(data.NODE_ENV).toBe("production");
  });

  it("should override from process", () => {
    const { data } = parseEnv(
      createTmpEnv({
        NODE_ENV: "production",
      }),
      {
        NODE_ENV: "development",
      },
    );
    expect(data.NODE_ENV).toBe("development");
  });

  it("rejects invalid NODE_ENV", () => {
    expect(() => parseEnv(undefined, { NODE_ENV: "invalid" })).toThrow();
  });

  it("rejects invalid DOCKER_TARGET", () => {
    expect(() => parseEnv(undefined, { DOCKER_TARGET: "invalid" })).toThrow();
  });

  it("should use provided DOCKER_TAG if present", () => {
    const { data } = parseEnv(undefined, {
      DOCKER_TAG: "docker.io/custom/image:1.0.0",
    });
    expect(data.DOCKER_TAG).toBe("docker.io/custom/image:1.0.0");
    expect(data.DOCKER_REGISTRY).toBe("docker.io");
    expect(data.DOCKER_IMAGE).toBe("custom/image");
    expect(data.DOCKER_VERSION).toBe("1.0.0");
  });

  it("should construct tag from components if DOCKER_TAG not present", () => {
    const { data } = parseEnv(undefined, {
      DOCKER_REGISTRY: "quay.io",
      DOCKER_IMAGE: "custom/image",
      DOCKER_VERSION: "2.0.0",
      DOCKER_DIGEST,
    });
    expect(data.DOCKER_TAG).toBe(`quay.io/custom/image:2.0.0@${DOCKER_DIGEST}`);
  });

  it("should use base tag when no docker config provided", () => {
    const { data } = parseEnv(undefined, {});
    expect(data.DOCKER_TAG).toBe("base/repo:local");
  });

  it("should force production target for non-local image", () => {
    const { data } = parseEnv(undefined, {
      DOCKER_TAG: "docker.io/base/repo:1.0.0",
      DOCKER_TARGET: "development",
    });
    expect(data.DOCKER_TARGET).toBe("production");
  });

  it("should also force NODE_ENV to production for non-local image", () => {
    const { data } = parseEnv(undefined, {
      DOCKER_TAG: "docker.io/base/repo:1.0.0",
      NODE_ENV: "development",
    });
    expect(data.NODE_ENV).toBe("production");
  });

  it.each(["development", "production"])(
    "should allow either target for local image",
    (target) => {
      const { data } = parseEnv(undefined, {
        DOCKER_TAG: "docker.io/base/repo:local",
        DOCKER_TARGET: target,
      });
      expect(data.DOCKER_TARGET).toBe(target);
    },
  );

  it.each(["development", "production"])(
    "should preserve NODE_ENV for local image (%s)",
    (nodeEnv) => {
      const { data } = parseEnv(undefined, {
        DOCKER_TAG: "base/repo:local",
        NODE_ENV: nodeEnv,
      });
      expect(data.NODE_ENV).toBe(nodeEnv);
    },
  );

  it("should throw error when digest provided without version", () => {
    expect(() =>
      parseEnv(undefined, {
        DOCKER_TAG: `${DOCKER_DIGEST}`,
      }),
    ).toThrow("Cannot parse image with only a digest:");
  });

  it("should handle version-only input correctly", () => {
    const { data } = parseEnv(undefined, {
      DOCKER_TAG: "3.0.0",
    });
    expect(data.DOCKER_TAG).toBe("base/repo:3.0.0");
  });

  it("should handle version and digest input correctly", () => {
    const { data } = parseEnv(undefined, {
      DOCKER_TAG: `1.0.0@${DOCKER_DIGEST}`,
    });
    expect(data.DOCKER_TAG).toBe(`base/repo:1.0.0@${DOCKER_DIGEST}`);
  });

  it("should handle image-only input correctly", () => {
    const { data } = parseEnv(undefined, {
      DOCKER_TAG: "custom/image:1.0.0",
    });
    expect(data.DOCKER_TAG).toBe("custom/image:1.0.0");
  });

  it("should handle basic image:tag input correctly", () => {
    const { data } = parseEnv(undefined, {
      DOCKER_TAG: "nginx:latest",
    });
    expect(data.DOCKER_TAG).toBe("nginx:latest");
    expect(data.DOCKER_REGISTRY).toBe("");
    expect(data.DOCKER_IMAGE).toBe("nginx");
    expect(data.DOCKER_VERSION).toBe("latest");
  });

  it("should handle image:tag@digest input correctly", () => {
    const { data } = parseEnv(undefined, {
      DOCKER_TAG: `nginx:latest@${DOCKER_DIGEST}`,
    });
    expect(data.DOCKER_TAG).toBe(`nginx:latest@${DOCKER_DIGEST}`);
    expect(data.DOCKER_REGISTRY).toBe("");
    expect(data.DOCKER_IMAGE).toBe("nginx");
    expect(data.DOCKER_VERSION).toBe("latest");
    expect(data.DOCKER_DIGEST).toBe(DOCKER_DIGEST);
  });

  it("should throw an error for an invalid tag format", () => {
    expect(() =>
      parseEnv(undefined, {
        DOCKER_TAG: "invalid:tag:format:with:many:colons",
      }),
    ).toThrow("Invalid image tag:");
  });
});
