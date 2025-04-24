import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

import main from "./env";

const root = path.resolve(fileURLToPath(import.meta.url));

const DOCKER_DIGEST =
  "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

const config = {
  dryRun: true,
  root,
  env: {
    NODE_ENV: "development",
  },
};

describe("env", () => {
  it("default env", async () => {
    const env = await main(config);
    expect(env).toMatchSnapshot();
  });

  it("handles basic docker tag parsing", async () => {
    const env = await main({
      ...config,
      env: {
        DOCKER_TAG: "nginx:latest",
      },
    });
    expect(env.DOCKER_TAG).toBe("docker.io/nginx:latest");
    expect(env.DOCKER_REGISTRY).toBe("docker.io");
    expect(env.DOCKER_IMAGE).toBe("nginx");
    expect(env.DOCKER_VERSION).toBe("latest");
  });

  it("handles docker tag with digest", async () => {
    const env = await main({
      ...config,
      env: {
        DOCKER_TAG: `nginx:latest@sha256:${DOCKER_DIGEST}`,
      },
    });
    expect(env.DOCKER_TAG).toBe(
      `docker.io/nginx:latest@sha256:${DOCKER_DIGEST}`,
    );
    expect(env.DOCKER_DIGEST).toBe(DOCKER_DIGEST);
  });

  it("handles custom registry", async () => {
    const env = await main({
      ...config,
      env: {
        DOCKER_TAG: "registry.example.com/nginx:latest",
      },
    });
    expect(env.DOCKER_TAG).toBe("registry.example.com/nginx:latest");
    expect(env.DOCKER_REGISTRY).toBe("registry.example.com");
  });

  it("forces production environment for non-local versions", async () => {
    const env = await main({
      ...config,
      env: {
        DOCKER_TAG: "nginx:1.0",
        NODE_ENV: "development",
        DOCKER_TARGET: "development",
      },
    });
    expect(env.NODE_ENV).toBe("production");
    expect(env.DOCKER_TARGET).toBe("production");
  });

  it("preserves local version environment settings", async () => {
    const env = await main({
      ...config,
      env: {
        DOCKER_TAG: "local",
        NODE_ENV: "development",
        DOCKER_TARGET: "development",
      },
    });
    expect(env.NODE_ENV).toBe("development");
    expect(env.DOCKER_TARGET).toBe("development");
  });

  it("handles mozilla/addons-server special case", async () => {
    const env = await main({
      ...config,
      env: {
        DOCKER_TAG: "latest",
      },
    });
    expect(env.DOCKER_TAG).toBe("docker.io/mozilla/addons-server:latest");
    expect(env.DOCKER_IMAGE).toBe("mozilla/addons-server");
  });

  it("validates environment values", async () => {
    await expect(
      main({
        ...config,
        env: {
          NODE_ENV: "invalid",
        },
      }),
    ).rejects.toThrow();
  });

  it("validates docker tag format", async () => {
    await expect(
      main({
        ...config,
        env: {
          DOCKER_TAG: "invalid:tag:format",
        },
      }),
    ).rejects.toThrow();
  });

  it("requires version when digest is present", async () => {
    await expect(
      main({
        ...config,
        env: {
          DOCKER_TAG:
            "@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        },
      }),
    ).rejects.toThrow();
  });
});
