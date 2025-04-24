import { z } from "zod";
import { path, fs, dotenv, chalk } from "zx";

// Define the Docker tag regex using named capture groups.
// This regex matches a docker tag of the form:
//   image[:version][@sha256:digest]
//
// Breakdown:
// - ^ and $ ensure we match the full string.
// - (?<image>[^:@]+): Matches the image name as anything except ':' and '@'.
// - (?:\:(?<version>(?![\.-])[a-zA-Z0-9_.-]{1,128}))?: Optionally matches ':version' where version must not start with '.' or '-'.
// - (?:@sha256:(?<digest>[a-fA-F0-9]{64}))?: Optionally matches '@sha256:' followed by 64 hexadecimal characters.
const DOCKER_TAG_REGEX =
  /^((?<image>[^:@]+))(?::(?<version>(?![.-])[a-zA-Z0-9_.-]{1,128}))?(?:@sha256:(?<digest>[a-fA-F0-9]{64}))?$/;

const dockerTagParser = z.string().transform((tag, ctx) => {
  const match = tag.match(DOCKER_TAG_REGEX);
  if (!match || !match.groups) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid image tag: ${tag}`,
    });
    return z.NEVER;
  }

  let image = "";
  let version = "";
  let digest = "";

  ({ image, version, digest } = match.groups);
  let registry = "docker.io";

  if (
    image &&
    !version &&
    !digest &&
    !image.includes(":") &&
    !image.includes("@")
  ) {
    version = image;
    image = "mozilla/addons-server";
  } else if (image && !version && digest && !image.includes(":")) {
    version = image;
    image = "mozilla/addons-server";
  }

  if (digest && !version) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid image tag: ${tag} (when specifying a digest, a version is required)`,
    });
    return z.NEVER;
  }

  if (image.includes(".")) {
    [registry, ...image] = image.split("/");
    image = image.join("/");
  }

  let fullTag = `${registry}/${image}`;
  if (version) {
    fullTag += `:${version}`;
  }
  if (digest) {
    fullTag += `@sha256:${digest}`;
  }
  return { fullTag, registry, image, version, digest };
});

const envParser = z.enum(["development", "production"]);

const schema = z
  .object({
    NODE_ENV: envParser.optional().default("development"),
    DOCKER_TARGET: envParser.optional().default("development"),
    DOCKER_TAG: dockerTagParser
      .optional()
      .default("local")
      .transform((tag) => tag.fullTag),
    // Values that are replaced by the DOCKER_TAG parser.
    DOCKER_REGISTRY: z.any().optional(),
    DOCKER_IMAGE: z.any().optional(),
    DOCKER_VERSION: z.any().optional(),
    DOCKER_DIGEST: z.any().optional(),
  })
  .transform((data) => {
    const { fullTag, registry, image, version, digest } = dockerTagParser.parse(
      data.DOCKER_TAG,
    );
    const defaultTarget = version === "local" ? "development" : "production";

    if (version !== "local") {
      for (const key of ["DOCKER_TARGET", "NODE_ENV"]) {
        let current = data[key];
        if (current !== defaultTarget) {
          data[key] = defaultTarget;
          console.log(
            chalk.yellow(
              `Forcing "${key}" to "${defaultTarget}" on non-local image ${fullTag}`,
            ),
          );
        }
      }
    }

    data.DOCKER_TAG = fullTag;
    data.DOCKER_REGISTRY = registry;
    data.DOCKER_IMAGE = image;
    data.DOCKER_VERSION = version;
    data.DOCKER_DIGEST = digest;
    return data;
  })
  .superRefine((data, ctx) => {
    const { version } = dockerTagParser.parse(data.DOCKER_TAG);

    if (version && version !== "local" && data.DOCKER_TARGET !== "production") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid docker tag: ${data.DOCKER_TAG} (when specifying a version, the target must be production)`,
      });
      return z.NEVER;
    }
  });

export default async function main(config) {
  const baseEnv = schema.parse({});

  const envFile = path.join(config.root, ".env");
  let fileEnv = {};
  if (fs.existsSync(envFile)) {
    fileEnv = schema.parse(dotenv.load(envFile));
  }
  const processEnv = schema.parse(config.env);
  const inputEnv = { ...baseEnv, ...fileEnv, ...processEnv };
  const outputEnv = Object.fromEntries(
    Object.entries(schema.parse(inputEnv))
      .filter(([, value]) => value !== undefined)
      .sort((a, b) => a[0].localeCompare(b[0])),
  );

  const outputEnvString = dotenv.stringify(outputEnv);

  if (!config.dryRun) {
    fs.writeFileSync(envFile, outputEnvString);
    console.log(chalk.green("Updated .env file"));
    for (const [key, value] of Object.entries(outputEnv)) {
      const text = `${key}=${value}`;
      console.log(text);
    }
  }
  return outputEnv;
}
