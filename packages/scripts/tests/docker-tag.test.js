import { describe, it, expect } from "vitest";
import { DockerTag } from "../src/docker-tag.js";

const DOCKER_DIGEST =
  "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

const VALID_DOCKER_TAGS = [
  "docker.io/mozilla/addons-server",
  "docker.io/mozilla/addons-server:latest",
  `docker.io/mozilla/addons-server@sha256:${DOCKER_DIGEST}`,
  "docker.io/mozilla/addons-server:1.0.0",
  `mozilla/addons-server:version@sha256:${DOCKER_DIGEST}`,
  "mozilla/addons-server:latest",
  `mozilla/addons-server@sha256:${DOCKER_DIGEST}`,
  "mozilla/addons-server:1.0.0",
  `mozilla/addons-server:version@sha256:${DOCKER_DIGEST}`,
  "addons-server:latest",
  "latest",
  "3.0.0",
];

const INVALID_DOCKER_TAGS = [
  "docker.io/mozilla/addons-server:",
  "docker.io/mozilla/addons-server@sha256:123",
  ":latest",
  "addons-server@sha256:1234567890",
];

describe("DockerTag", () => {
  it.each(VALID_DOCKER_TAGS)("should parse %s", (tag) => {
    const dockerTag = new DockerTag(tag);
    expect(dockerTag.fullTag).toBe(tag);
    expect(dockerTag.parsed).toEqual(DockerTag.parse(tag));
  });

  it.each(INVALID_DOCKER_TAGS)("should not parse %s", (tag) => {
    expect(() => new DockerTag(tag)).toThrow();
  });
});
