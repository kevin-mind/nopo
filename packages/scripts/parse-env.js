import { parseEnv as znvParseEnv, z } from "znv";
import { fs, chalk, dotenv } from "zx";

import { DockerTag } from "./docker-tag.js";

const baseTag = new DockerTag("docker.io/mozilla/addons-server:local");

const envParser = z.enum(["development", "production"]);

const baseSchema = {
  NODE_ENV: envParser.optional(),
  DOCKER_TARGET: envParser.optional(),
  DOCKER_TAG: z.string().optional(),
  DOCKER_REGISTRY: z.string().optional(),
  DOCKER_IMAGE: z.string().optional(),
  DOCKER_VERSION: z.string().optional(),
  DOCKER_DIGEST: z.string().optional(),
};

const schema = z.object(baseSchema).transform((data) => {
  let tag = null;
  if (data.DOCKER_TAG) {
    tag = new DockerTag(data.DOCKER_TAG);
  } else {
    tag = baseTag;
  }

  let { registry, image, version, digest } = tag.parsed;

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

  data.DOCKER_TAG = tag.fullTag;
  data.DOCKER_REGISTRY = tag.parsed.registry;
  data.DOCKER_IMAGE = tag.parsed.image;
  data.DOCKER_VERSION = tag.parsed.version;
  data.DOCKER_DIGEST = tag.parsed.digest;
  return data;
});

export function parseEnv(envFilePath, processEnv = {}) {
  /*
  We need to move some of the transform logic into parseEnv.
  - we want to prioritize process over file
  - but also prioritize DOCKER_TAG over DOCKER_* variables.
  - Ex: if we have DOCKER_* defined in file but DOCKER_TAG in process, we should only use the DOCKER_TAG from the process.
  - Ex: if we have DOCKER_* defined in file, and some DOCKER_* in process, we should merge them together.
  - We want the transform logic to apply to the merged output, but we don't necessarily want to handle this identically for each source and we don't want to cross pollute all variables from both sources.

  */
  let fileEnv = {};
  if (fs.existsSync(envFilePath)) {
    fileEnv = schema.parse(dotenv.load(envFilePath));
  }
  const outputEnv = schema.parse({ ...fileEnv, ...processEnv });

  const finalEnv = znvParseEnv(outputEnv, baseSchema);
  return Object.fromEntries(
    Object.entries(finalEnv).filter(([, value]) => value !== undefined),
  );
}
