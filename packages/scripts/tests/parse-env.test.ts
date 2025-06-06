import { describe, it, expect, vi } from "vitest";

import { ParseEnv } from "../src/parse-env";
import { dockerTag, createTmpEnv } from "./utils";

vi.mock("../src/git-info", () => ({
  GitInfo: {
    parse: vi.fn(() => ({
      repo: "git-repo",
      branch: "git-branch",
      commit: "git-commit",
    })),
  },
}));

describe("parseEnv", () => {
  it("should parse the env", () => {
    const {
      env: { HOST_UID, GIT_BRANCH, GIT_COMMIT, GIT_REPO, ...env },
    } = new ParseEnv(createTmpEnv());
    expect(HOST_UID).toBe(process.getuid?.()?.toString());
    expect(GIT_REPO).toStrictEqual("git-repo");
    expect(GIT_BRANCH).toStrictEqual("git-branch");
    expect(GIT_COMMIT).toStrictEqual("git-commit");
    expect(env).toMatchSnapshot();
  });

  it("should override from file", () => {
    const { env } = new ParseEnv(
      createTmpEnv({
        NODE_ENV: "production",
      }),
    );
    expect(env.NODE_ENV).toBe("production");
  });

  it("should override from process", () => {
    const { env } = new ParseEnv(
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
    expect(() => new ParseEnv(createTmpEnv({ NODE_ENV: "invalid" }))).toThrow(
      "Invalid enum value",
    );
  });

  it("rejects invalid DOCKER_TARGET", () => {
    expect(
      () => new ParseEnv(createTmpEnv({ DOCKER_TARGET: "invalid" })),
    ).toThrow("Invalid enum value");
  });

  it("should use provided DOCKER_TAG if present", () => {
    const { env } = new ParseEnv(
      createTmpEnv({
        DOCKER_TAG: dockerTag.fullTag,
      }),
    );
    expect(env.DOCKER_TAG).toBe(dockerTag.fullTag);
    expect(env.DOCKER_REGISTRY).toBe(dockerTag.parsed.registry);
    expect(env.DOCKER_IMAGE).toBe(dockerTag.parsed.image);
    expect(env.DOCKER_VERSION).toBe(dockerTag.parsed.version);
  });

  it("should construct tag from components if DOCKER_TAG not present", () => {
    const { env } = new ParseEnv(
      createTmpEnv({
        DOCKER_REGISTRY: dockerTag.parsed.registry,
        DOCKER_IMAGE: dockerTag.parsed.image,
        DOCKER_VERSION: dockerTag.parsed.version,
        DOCKER_DIGEST: dockerTag.parsed.digest,
      }),
    );
    expect(env.DOCKER_TAG).toBe(dockerTag.fullTag);
  });

  it("should ignore empty DOCKER_TAG when components are provided", async () => {
    const { env } = new ParseEnv(
      createTmpEnv({
        DOCKER_TAG: "",
        DOCKER_REGISTRY: dockerTag.parsed.registry,
        DOCKER_IMAGE: dockerTag.parsed.image,
        DOCKER_VERSION: dockerTag.parsed.version,
        DOCKER_DIGEST: dockerTag.parsed.digest,
      }),
    );
    expect(env.DOCKER_TAG).toBe(dockerTag.fullTag);
  });

  it("should use base tag when no docker config provided", () => {
    const { env } = new ParseEnv(createTmpEnv());
    expect(env.DOCKER_TAG).toBe(ParseEnv.baseTag.fullTag);
  });

  it("should force production target for non-local image", () => {
    const { env } = new ParseEnv(
      createTmpEnv({
        DOCKER_TAG: "docker.io/base/repo:1.0.0",
        DOCKER_TARGET: "development",
      }),
    );
    expect(env.DOCKER_TARGET).toBe("production");
  });

  it("should also force NODE_ENV to production for non-local image", () => {
    const { env } = new ParseEnv(
      createTmpEnv({
        DOCKER_TAG: "docker.io/base/repo:1.0.0",
        NODE_ENV: "development",
      }),
    );
    expect(env.NODE_ENV).toBe("production");
  });

  it.each(["development", "production"])(
    "should allow either target for local image",
    (target) => {
      const { env } = new ParseEnv(
        createTmpEnv({
          DOCKER_TAG: "docker.io/base/repo:local",
          DOCKER_TARGET: target,
        }),
      );
      expect(env.DOCKER_TARGET).toBe(target);
    },
  );

  it.each(["development", "production"])(
    "should preserve NODE_ENV for local image (%s)",
    (nodeEnv) => {
      const { env } = new ParseEnv(
        createTmpEnv({
          DOCKER_TAG: "base/repo:local",
          NODE_ENV: nodeEnv,
        }),
      );
      expect(env.NODE_ENV).toBe(nodeEnv);
    },
  );

  it("should throw error when digest provided without version", () => {
    expect(
      () =>
        new ParseEnv(
          createTmpEnv({
            DOCKER_TAG: `${dockerTag.parsed.digest}`,
          }),
        ),
    ).toThrow("Cannot parse image with only a digest:");
  });

  it("should handle version-only input correctly", () => {
    const { env } = new ParseEnv(
      createTmpEnv({
        DOCKER_TAG: "3.0.0",
      }),
    );
    expect(env.DOCKER_TAG).toBe("kevin-mind/nopo:3.0.0");
  });

  it("should handle version and digest input correctly", () => {
    const { env } = new ParseEnv(
      createTmpEnv({
        DOCKER_TAG: `1.0.0@${dockerTag.parsed.digest}`,
      }),
    );
    expect(env.DOCKER_TAG).toBe(
      `kevin-mind/nopo:1.0.0@${dockerTag.parsed.digest}`,
    );
  });

  it("should handle image-only input correctly", () => {
    const { env } = new ParseEnv(
      createTmpEnv({
        DOCKER_TAG: "custom/image:1.0.0",
      }),
    );
    expect(env.DOCKER_TAG).toBe("custom/image:1.0.0");
  });

  it("should handle basic image:tag input correctly", () => {
    const { env } = new ParseEnv(
      createTmpEnv({
        DOCKER_TAG: "nginx:latest",
      }),
    );
    expect(env.DOCKER_TAG).toBe("nginx:latest");
    expect(env.DOCKER_REGISTRY).toBe("");
    expect(env.DOCKER_IMAGE).toBe("nginx");
    expect(env.DOCKER_VERSION).toBe("latest");
  });

  it("should handle image:tag@digest input correctly", () => {
    const { env } = new ParseEnv(
      createTmpEnv({
        DOCKER_TAG: `nginx:latest@${dockerTag.parsed.digest}`,
      }),
    );
    expect(env.DOCKER_TAG).toBe(`nginx:latest@${dockerTag.parsed.digest}`);
    expect(env.DOCKER_REGISTRY).toBe("");
    expect(env.DOCKER_IMAGE).toBe("nginx");
    expect(env.DOCKER_VERSION).toBe("latest");
    expect(env.DOCKER_DIGEST).toBe(dockerTag.parsed.digest);
  });

  it("should throw an error for an invalid tag format", () => {
    expect(
      () =>
        new ParseEnv(
          createTmpEnv({
            DOCKER_TAG: "invalid:tag:format:with:many:colons",
          }),
        ),
    ).toThrow("Invalid image tag:");
  });
});
