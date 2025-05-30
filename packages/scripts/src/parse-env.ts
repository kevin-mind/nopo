import { z } from "zod";
import { fs, dotenv } from "zx";

import { DockerTag } from "./docker-tag.js";

const nodeEnv = z.enum(["development", "production", "test"]);
const dockerTarget = nodeEnv.or(z.enum(["base", "build"]));

type ParseEnvDiffTuple = [string, string | undefined];

interface ParseEnvDiff {
  added: ParseEnvDiffTuple[];
  updated: ParseEnvDiffTuple[];
  removed: ParseEnvDiffTuple[];
  unchanged: ParseEnvDiffTuple[];
}

export class ParseEnv {
  static baseTag = new DockerTag("kevin-mind/nopo:local");
  static schema = z.object({
    DOCKER_TAG: z.string(),
    DOCKER_REGISTRY: z.string(),
    DOCKER_IMAGE: z.string(),
    DOCKER_VERSION: z.string(),
    DOCKER_DIGEST: z.string().optional(),
    DOCKER_TARGET: dockerTarget,
    NODE_ENV: nodeEnv,
    HOST_UID: z.string(),
  });

  envFile: string;
  processEnv: NodeJS.ProcessEnv;
  hasPrevEnv: boolean;
  prevEnv: NodeJS.ProcessEnv;
  env: z.infer<typeof ParseEnv.schema>;
  diff: ParseEnvDiff;

  constructor(envFile: string, processEnv: NodeJS.ProcessEnv = {}) {
    if (!envFile) {
      throw new Error("Missing envFile");
    }

    this.envFile = envFile;
    this.processEnv = processEnv;
    this.hasPrevEnv = fs.existsSync(this.envFile);
    this.prevEnv = this.#getPrevEnv();
    this.env = this.#getCurrEnv();
    this.diff = this.#diff();
  }

  #getPrevEnv() {
    return this.hasPrevEnv ? dotenv.load(this.envFile) : {};
  }

  resolveDockerTag() {
    if (this.processEnv.DOCKER_TAG) {
      return new DockerTag(this.processEnv.DOCKER_TAG);
    } else if (this.processEnv.DOCKER_IMAGE && this.processEnv.DOCKER_VERSION) {
      return new DockerTag({
        registry: this.processEnv.DOCKER_REGISTRY || "",
        image: this.processEnv.DOCKER_IMAGE,
        version: this.processEnv.DOCKER_VERSION,
        digest: this.processEnv.DOCKER_DIGEST,
      });
    } else if (this.prevEnv.DOCKER_TAG) {
      return new DockerTag(this.prevEnv.DOCKER_TAG);
    } else if (this.prevEnv.DOCKER_IMAGE && this.prevEnv.DOCKER_VERSION) {
      return new DockerTag({
        registry: this.prevEnv.DOCKER_REGISTRY || "",
        image: this.prevEnv.DOCKER_IMAGE,
        version: this.prevEnv.DOCKER_VERSION,
        digest: this.prevEnv.DOCKER_DIGEST,
      });
    } else {
      return ParseEnv.baseTag;
    }
  }

  #getCurrEnv() {
    const inputEnv = { ...this.prevEnv, ...this.processEnv };
    const { parsed, fullTag } = this.resolveDockerTag();
    let registry = parsed.registry;
    let image = parsed.image;
    let version = parsed.version;
    const digest = parsed.digest;

    if (
      image &&
      !version &&
      !digest &&
      !image.includes(":") &&
      !image.includes("@")
    ) {
      version = image;
      image = ParseEnv.baseTag.parsed.image;
    } else if (image && !version && digest && !image.includes(":")) {
      version = image;
      image = ParseEnv.baseTag.parsed.image;
    }

    if (digest && !version) {
      throw new Error(
        `Invalid image tag: ${fullTag} (when specifying a digest, a version is required)`,
      );
    }

    if (!registry) {
      registry = ParseEnv.baseTag.parsed.registry;
    }

    const isLocal = version === "local";
    const defaultTarget = isLocal ? "development" : "production";

    for (const key of ["DOCKER_TARGET", "NODE_ENV"]) {
      const current = inputEnv[key];
      const isMissing = !current;
      const isWrong = !isLocal && current !== defaultTarget;
      if (isMissing || isWrong) {
        inputEnv[key] = defaultTarget;
      }
    }

    return ParseEnv.schema.parse({
      DOCKER_TAG: new DockerTag({ registry, image, version, digest }).fullTag,
      DOCKER_REGISTRY: registry,
      DOCKER_IMAGE: image,
      DOCKER_VERSION: version,
      DOCKER_DIGEST: digest,
      NODE_ENV: inputEnv.NODE_ENV,
      DOCKER_TARGET: inputEnv.DOCKER_TARGET,
      HOST_UID: process.getuid?.()?.toString(),
    });
  }

  #diff() {
    const result: ParseEnvDiff = {
      added: [],
      updated: [],
      removed: [],
      unchanged: [],
    };

    const keys = Object.keys(ParseEnv.schema.shape) as (keyof z.infer<
      typeof ParseEnv.schema
    >)[];

    for (const key of keys) {
      const prevValue = this.prevEnv[key];
      const currValue = this.env[key];

      if (!prevValue && currValue) {
        result.added.push([key, currValue]);
      } else if (prevValue && !currValue) {
        result.removed.push([key, prevValue]);
      } else if (currValue && prevValue !== currValue) {
        result.updated.push([key, currValue]);
      } else if (currValue) {
        result.unchanged.push([key, prevValue]);
      }
    }
    return result;
  }

  save() {
    const sortedEnv = Object.entries(this.env)
      .filter(([, value]) => !!value)
      .sort((a, b) => a[0].localeCompare(b[0]));

    const sortedEnvString = sortedEnv
      .map(([key, value]) => `${key}="${value}"`)
      .join("\n");

    fs.writeFileSync(this.envFile, sortedEnvString);
  }
}
