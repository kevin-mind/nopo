import { describe, it, expect, vi } from "vitest";

import { Environment } from "../src/parse-env";
import { dockerTag, createTmpEnv } from "./utils";
import { createConfig } from "../src/lib";

vi.mock("../src/git-info", () => ({
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

describe("parseEnv", () => {
  it("should parse the env", () => {
    const config = createConfig({
      envFile: createTmpEnv(),
      processEnv: {},
      silent: true,
    });
    const {
      env: { HOST_UID, GIT_BRANCH, GIT_COMMIT, GIT_REPO, DOCKER_PORT, ...env },
    } = new Environment(config);
    expect(HOST_UID).toBe(process.getuid?.()?.toString());
    expect(GIT_REPO).toStrictEqual("unknown");
    expect(GIT_BRANCH).toStrictEqual("unknown");
    expect(GIT_COMMIT).toStrictEqual("unknown");
    expect(DOCKER_PORT).toBe("80");
    expect(env).toMatchSnapshot();
  });

  it("should override from file", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        NODE_ENV: "production",
      }),
      processEnv: {},
      silent: true,
    });
    const { env } = new Environment(config);
    expect(env.NODE_ENV).toBe("production");
  });

  it("should override from process", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        NODE_ENV: "production",
      }),
      processEnv: {
        NODE_ENV: "development",
      },
      silent: true,
    });
    const { env } = new Environment(config);
    expect(env.NODE_ENV).toBe("development");
  });

  it("rejects invalid NODE_ENV", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        NODE_ENV: "invalid",
      }),
      processEnv: {},
      silent: true,
    });
    expect(() => new Environment(config)).toThrow("Invalid enum value");
  });

  it("rejects invalid DOCKER_TARGET", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TARGET: "invalid",
      }),
      processEnv: {},
      silent: true,
    });
    expect(() => new Environment(config)).toThrow("Invalid enum value");
  });

  it("should use provided DOCKER_TAG if present", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: dockerTag.fullTag,
      }),
      processEnv: {},
      silent: true,
    });
    const { env } = new Environment(config);
    expect(env.DOCKER_TAG).toBe(dockerTag.fullTag);
    expect(env.DOCKER_REGISTRY).toBe(dockerTag.parsed.registry);
    expect(env.DOCKER_IMAGE).toBe(dockerTag.parsed.image);
    expect(env.DOCKER_VERSION).toBe(dockerTag.parsed.version);
  });

  it("should construct tag from components if DOCKER_TAG not present", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_REGISTRY: dockerTag.parsed.registry,
        DOCKER_IMAGE: dockerTag.parsed.image,
        DOCKER_VERSION: dockerTag.parsed.version,
        DOCKER_DIGEST: dockerTag.parsed.digest,
      }),
      processEnv: {},
      silent: true,
    });
    const { env } = new Environment(config);
    expect(env.DOCKER_TAG).toBe(dockerTag.fullTag);
  });

  it("should ignore empty DOCKER_TAG when components are provided", async () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "",
        DOCKER_REGISTRY: dockerTag.parsed.registry,
        DOCKER_IMAGE: dockerTag.parsed.image,
        DOCKER_VERSION: dockerTag.parsed.version,
        DOCKER_DIGEST: dockerTag.parsed.digest,
      }),
      processEnv: {},
      silent: true,
    });
    const { env } = new Environment(config);
    expect(env.DOCKER_TAG).toBe(dockerTag.fullTag);
  });

  it("should use base tag when no docker config provided", () => {
    const config = createConfig({
      envFile: createTmpEnv(),
      processEnv: {},
      silent: true,
    });
    const { env } = new Environment(config);
    expect(env.DOCKER_TAG).toBe(Environment.baseTag.fullTag);
  });

  it("should force production target for non-local image", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "docker.io/base/repo:1.0.0",
        DOCKER_TARGET: "development",
      }),
      processEnv: {},
      silent: true,
    });
    const { env } = new Environment(config);
    expect(env.DOCKER_TARGET).toBe("production");
  });

  it("should also force NODE_ENV to production for non-local image", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "docker.io/base/repo:1.0.0",
        NODE_ENV: "development",
      }),
      processEnv: {},
      silent: true,
    });
    const { env } = new Environment(config);
    expect(env.NODE_ENV).toBe("production");
  });

  it.each(["development", "production"])(
    "should allow either target for local image",
    (target) => {
      const config = createConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "docker.io/base/repo:local",
          DOCKER_TARGET: target,
        }),
        processEnv: {},
        silent: true,
      });
      const { env } = new Environment(config);
      expect(env.DOCKER_TARGET).toBe(target);
    },
  );

  it.each(["development", "production"])(
    "should preserve NODE_ENV for local image (%s)",
    (nodeEnv) => {
      const config = createConfig({
        envFile: createTmpEnv({
          DOCKER_TAG: "base/repo:local",
          NODE_ENV: nodeEnv,
        }),
        processEnv: {},
        silent: true,
      });
      const { env } = new Environment(config);
      expect(env.NODE_ENV).toBe(nodeEnv);
    },
  );

  it("should throw error when digest provided without version", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: `${dockerTag.parsed.digest}`,
      }),
      processEnv: {},
      silent: true,
    });
    expect(() => new Environment(config)).toThrow(
      "Cannot parse image with only a digest:",
    );
  });

  it("should handle version-only input correctly", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "3.0.0",
      }),
      processEnv: {},
      silent: true,
    });
    const { env } = new Environment(config);
    expect(env.DOCKER_TAG).toBe("kevin-mind/nopo:3.0.0");
  });

  it("should handle version and digest input correctly", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: `1.0.0@${dockerTag.parsed.digest}`,
      }),
      processEnv: {},
      silent: true,
    });
    const { env } = new Environment(config);
    expect(env.DOCKER_TAG).toBe(
      `kevin-mind/nopo:1.0.0@${dockerTag.parsed.digest}`,
    );
  });

  it("should handle image-only input correctly", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "custom/image:1.0.0",
      }),
      processEnv: {},
      silent: true,
    });
    const { env } = new Environment(config);
    expect(env.DOCKER_TAG).toBe("custom/image:1.0.0");
  });

  it("should handle basic image:tag input correctly", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "nginx:latest",
      }),
      processEnv: {},
      silent: true,
    });
    const { env } = new Environment(config);
    expect(env.DOCKER_TAG).toBe("nginx:latest");
    expect(env.DOCKER_REGISTRY).toBe("");
    expect(env.DOCKER_IMAGE).toBe("nginx");
    expect(env.DOCKER_VERSION).toBe("latest");
  });

  it("should handle image:tag@digest input correctly", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: `nginx:latest@${dockerTag.parsed.digest}`,
      }),
      processEnv: {},
      silent: true,
    });
    const { env } = new Environment(config);
    expect(env.DOCKER_TAG).toBe(`nginx:latest@${dockerTag.parsed.digest}`);
    expect(env.DOCKER_REGISTRY).toBe("");
    expect(env.DOCKER_IMAGE).toBe("nginx");
    expect(env.DOCKER_VERSION).toBe("latest");
    expect(env.DOCKER_DIGEST).toBe(dockerTag.parsed.digest);
  });

  it("should throw an error for an invalid tag format", () => {
    const config = createConfig({
      envFile: createTmpEnv({
        DOCKER_TAG: "invalid:tag:format:with:many:colons",
      }),
      processEnv: {},
      silent: true,
    });
    expect(() => new Environment(config)).toThrow("Invalid image tag:");
  });
});
