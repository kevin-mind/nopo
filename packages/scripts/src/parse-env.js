import { parseEnv as znvParseEnv, z } from "znv";
import { fs, chalk, dotenv, $ } from "zx";

import { DockerTag } from "./docker-tag.js";

async function gitRepoName() {
  let org = "base";
  let repo = "repo";
  try {
    const urlString = await $`git config --get remote.origin.url`
      .quiet()
      .text();
    const url = new URL(urlString);
    const repoRegex = /^\/(?<org>[^/]+)\/(?<repo>[^/]+)\.git$/;
    const match = url.pathname.match(repoRegex);
    if (!match) {
      throw new Error("Could not determine git repo name");
    }
    org = match.groups.org;
    repo = match.groups.repo;
  } catch (e) {
    console.log(e);
  }
  return { org, repo };
}

const { org, repo } = await gitRepoName();
const baseTag = new DockerTag(`${org}/${repo}:local`);

const envParser = z.enum(["base", "build", "development", "production"]);

const baseSchema = {
  DOCKER_DIGEST: z.string(),
  DOCKER_IMAGE: z.string(),
  DOCKER_REGISTRY: z.string(),
  DOCKER_TAG: z.string(),
  DOCKER_TARGET: envParser,
  DOCKER_VERSION: z.string(),
  NODE_ENV: envParser,
  HOST_UID: z.string().default(process.getuid().toString()),
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

function resolveTag(fileEnv, processEnv) {
  // Resolve the tag in a prioritized order:

  // Highest priority is a fully formed tag on the environment.
  if (processEnv.DOCKER_TAG) {
    return new DockerTag(processEnv.DOCKER_TAG);
    // Next is tag components on the environment. At least an image and version
  } else if (processEnv.DOCKER_IMAGE && processEnv.DOCKER_VERSION) {
    return new DockerTag({
      registry: processEnv.DOCKER_REGISTRY,
      image: processEnv.DOCKER_IMAGE,
      version: processEnv.DOCKER_VERSION,
      digest: processEnv.DOCKER_DIGEST,
    });
    // Next is a fully formed tag on the file.
  } else if (fileEnv.DOCKER_TAG) {
    return new DockerTag(fileEnv.DOCKER_TAG);
    // Next is a tag components on the file. At least an image and version.
  } else if (fileEnv.DOCKER_IMAGE && fileEnv.DOCKER_VERSION) {
    return new DockerTag({
      registry: fileEnv.DOCKER_REGISTRY,
      image: fileEnv.DOCKER_IMAGE,
      version: fileEnv.DOCKER_VERSION,
    });
    // Finally, fall back to the base tag.
  } else {
    return baseTag;
  }
}

function diffEnv(env) {
  const colors = {
    added: chalk.magenta,
    updated: chalk.yellow,
    unchanged: chalk.white,
    background: chalk.gray,
  };

  const { hasPrevEnv } = env.meta;
  const action = hasPrevEnv ? "Updated" : "Created";
  const actionColor = hasPrevEnv ? colors.updated : colors.added;
  const title = `${action}: ${actionColor(env.meta.path)}`;
  const breakLine = chalk.gray(Array(title.length).fill("-").join(""));

  console.log(title);
  console.log(breakLine);
  Object.entries(colors).forEach(([key, color]) => {
    if (key === "background") return;
    console.log(`${colors.background(key)}: ${color(key)}`);
  });
  console.log(breakLine);

  for (const [key, value] of Object.entries(env.data)) {
    let color = colors.unchanged;
    if (!env.meta.prevEnv[key]) {
      color = colors.added;
    } else if (env.meta.prevEnv[key] !== value) {
      color = colors.updated;
    }
    const text = `${colors.background(key)}=${color(value)}`;
    console.log(text);
  }
}

export function parseEnv(
  envFilePath = undefined,
  processEnv = {},
  logDiff = true,
) {
  const hasPrevEnv = fs.existsSync(envFilePath);
  const fileEnv = hasPrevEnv ? dotenv.load(envFilePath) : {};

  let {
    parsed: { registry, image, version, digest },
    fullTag,
  } = resolveTag(fileEnv, processEnv);

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
    const isMissing = !current;
    const isWrong = !isLocal && current !== defaultTarget;
    if (isMissing || isWrong) {
      inputEnv[key] = defaultTarget;
      const action = isMissing ? "Adding" : "Forcing";
      const local = isLocal ? "local" : "non-local";
      console.log(
        chalk.yellow(
          `${action} "${key}" to "${defaultTarget}" on ${local} image ${fullTag}`,
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

  const sortedEnv = Object.entries(finalEnv)
    .filter(([, value]) => !!value)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const sortedEnvString = sortedEnv
    .map(([key, value]) => `${key}="${value}"`)
    .join("\n");

  if (envFilePath) {
    fs.writeFileSync(envFilePath, sortedEnvString);
  }

  const result = {
    data: finalEnv,
    meta: {
      isLocal,
      prevEnv: fileEnv,
      path: envFilePath,
    },
  };

  if (logDiff) {
    diffEnv(result);
  }

  return result;
}
