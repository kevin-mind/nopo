import { describe, it, expect } from "vitest";
import { DockerTag } from "../src/docker-tag.js";

const DOCKER_DIGEST =
  "sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

const VALID_DOCKER_TAGS = [
  [
    "docker.io/base/repo",
    {
      registry: "docker.io",
      image: "base/repo",
      version: "",
      digest: "",
    },
  ],
  [
    "docker.io/base/repo:latest",
    {
      registry: "docker.io",
      image: "base/repo",
      version: "latest",
      digest: "",
    },
  ],
  [
    `docker.io/base/repo@${DOCKER_DIGEST}`,
    {
      registry: "docker.io",
      image: "base/repo",
      version: "",
      digest: DOCKER_DIGEST,
    },
  ],
  [
    "docker.io/base/repo:1.0.0",
    {
      registry: "docker.io",
      image: "base/repo",
      version: "1.0.0",
      digest: "",
    },
  ],
  [
    `base/repo:version@${DOCKER_DIGEST}`,
    {
      registry: "",
      image: "base/repo",
      version: "version",
      digest: DOCKER_DIGEST,
    },
  ],
  [
    "addons-server:latest",
    {
      registry: "",
      image: "addons-server",
      version: "latest",
      digest: "",
    },
  ],
  [
    "latest",
    {
      registry: "",
      image: "latest",
      version: "",
      digest: "",
    },
  ],
  [
    "3.0.0",
    {
      registry: "",
      image: "3.0.0",
      version: "",
      digest: "",
    },
  ],
];

const INVALID_DOCKER_TAGS = [
  "docker.io/base/repo:",
  "docker.io/base/repo@sha256:123",
  ":latest",
  "addons-server@sha256:1234567890",
];

describe("DockerTag", () => {
  it.each(VALID_DOCKER_TAGS)("should parse %s", (tag, components) => {
    const fromTag = new DockerTag(tag);
    const toTag = new DockerTag(components);

    expect(fromTag.fullTag).toBe(tag);
    expect(fromTag.parsed).toEqual(components);
    expect(toTag.fullTag).toBe(tag);
    expect(toTag.parsed).toEqual(components);
  });

  it.each(INVALID_DOCKER_TAGS)("should not parse %s", (tag) => {
    expect(() => new DockerTag(tag)).toThrow();
  });
});
