import { parseEnv as znvParseEnv, z } from "znv";
import { fs, chalk, dotenv } from "zx";

import { DockerTag } from "./docker-tag.js";

const baseTag = new DockerTag("docker.io/mozilla/addons-server:local");

const envParser = z.enum(["development", "production"]);

const baseSchema = {
  NODE_ENV: envParser.default("development"),
  DOCKER_TARGET: envParser.default("development"),
  DOCKER_TAG: z.string().default(baseTag.fullTag),
  DOCKER_REGISTRY: z.string().default(baseTag.parsed.registry),
  DOCKER_IMAGE: z.string().default(baseTag.parsed.image),
  DOCKER_VERSION: z.string().default(baseTag.parsed.version),
  DOCKER_DIGEST: z.string().default(baseTag.parsed.digest),
};

const schema = z.object(baseSchema).transform((data) => {
  const tag = new DockerTag(data.DOCKER_TAG);
  const target = tag.parsed.version === baseTag.parsed.version ? "development" : "production";
  const isLocal = tag.parsed.version === baseTag.parsed.version;

  if (!isLocal) {
    data.NODE_ENV = target;
    data.DOCKER_TARGET = target;
  }

  data.DOCKER_TAG = tag.fullTag;
  data.DOCKER_REGISTRY = tag.parsed.registry;
  data.DOCKER_IMAGE = tag.parsed.image;
  data.DOCKER_VERSION = tag.parsed.version;
  data.DOCKER_DIGEST = tag.parsed.digest;
  return data;
});

export function parseEnv(envFilePath, processEnv = {}) {
  let fileEnv = {};
  if (fs.existsSync(envFilePath)) {
    fileEnv = schema.parse(dotenv.load(envFilePath));
  }
  const outputEnv = schema.parse({ ...fileEnv, ...processEnv });

  let { registry, image, version, digest } = new DockerTag(outputEnv.DOCKER_TAG);

  if (
    image &&
    !version &&
    !digest &&
    !image.includes(":") &&
    !image.includes("@")
  ) {
    version = image;
    image = baseTag.parsed.image;
  } else if (image && !version && digest && !image.includes(":")) {
    version = image;
    image = baseTag.parsed.image;
  }

  if (digest && !version) {
    throw new Error(
      `Invalid image tag: ${tag.fullTag} (when specifying a digest, a version is required)`,
    );
  }

  if (!registry) {
    registry = baseTag.parsed.registry;
  }

  tag = new DockerTag({ registry, image, version, digest });

  const isLocal = tag.parsed.version === baseTag.parsed.version;
  const defaultTarget = isLocal ? "development" : "production";

  for (const key of ["DOCKER_TARGET", "NODE_ENV"]) {
    let current = data[key];
    if (!current || (!isLocal && current !== defaultTarget)) {
      data[key] = defaultTarget;
      console.log(
        chalk.yellow(
          `Forcing "${key}" to "${defaultTarget}" on non-local image ${tag.fullTag}`,
        ),
      );
    }
  }

  const finalEnv = znvParseEnv(outputEnv, baseSchema);
  return Object.fromEntries(
    Object.entries(finalEnv).filter(([, value]) => value !== undefined),
  );
}
