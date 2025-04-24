import { parseEnv as znvParseEnv, z } from "znv";
import { fs, chalk, dotenv } from "zx";

import { DockerTag } from "./docker-tag.js";

const baseTag = new DockerTag("docker.io/mozilla/addons-server:local");

const envParser = z.enum(["development", "production"]);

const baseSchema = {
  DOCKER_DIGEST: z.string().optional(),
  DOCKER_IMAGE: z.string().optional(),
  DOCKER_REGISTRY: z.string().optional(),
  DOCKER_TAG: z.string().optional(),
  DOCKER_TARGET: envParser.optional(),
  DOCKER_VERSION: z.string().optional(),
  NODE_ENV: envParser.optional(),
};

const schema = z.object(baseSchema).superRefine((data, ctx) => {
  const actualTag = new DockerTag(data.DOCKER_TAG);
  const computedTag = new DockerTag({
    registry: data.DOCKER_REGISTRY,
    image: data.DOCKER_IMAGE,
    version: data.DOCKER_VERSION,
    digest: data.DOCKER_DIGEST,
  });

  if (actualTag.fullTag !== computedTag.fullTag) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid image tag: ${data.DOCKER_TAG} (expected ${computedTag.fullTag})`,
    });
  }
});

export function parseEnv(envFilePath, processEnv = {}) {
  const fileEnv = fs.existsSync(envFilePath) ? dotenv.load(envFilePath) : {};

  let {
    parsed: { registry, image, version, digest },
    fullTag,
  } = new DockerTag(
    processEnv.DOCKER_TAG || fileEnv.DOCKER_TAG || baseTag.fullTag,
  );

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
      `Invalid image tag: ${fullTag} (when specifying a digest, a version is required)`,
    );
  }

  if (!registry) {
    registry = baseTag.parsed.registry;
  }

  const inputEnv = { ...fileEnv, ...processEnv };
  const isLocal = version === baseTag.parsed.version;
  const defaultTarget = isLocal ? "development" : "production";

  for (const key of ["DOCKER_TARGET", "NODE_ENV"]) {
    let current = inputEnv[key];
    if (!current || (!isLocal && current !== defaultTarget)) {
      inputEnv[key] = defaultTarget;
      console.log(
        chalk.yellow(
          `Forcing "${key}" to "${defaultTarget}" on non-local image ${fullTag}`,
        ),
      );
    }
  }

  const env = schema.parse({
    DOCKER_TAG: DockerTag.stringify({ registry, image, version, digest }),
    DOCKER_REGISTRY: registry,
    DOCKER_IMAGE: image,
    DOCKER_VERSION: version,
    DOCKER_DIGEST: digest,
    NODE_ENV: inputEnv.NODE_ENV,
    DOCKER_TARGET: inputEnv.DOCKER_TARGET,
  });

  const finalEnv = znvParseEnv(
    {
      ...inputEnv,
      ...env,
    },
    baseSchema,
  );
  return Object.fromEntries(
    Object.entries(finalEnv).filter(([, value]) => value !== undefined),
  );
}
