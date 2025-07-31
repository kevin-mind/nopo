import { z } from "zod";
import { fs, dotenv } from "zx";
import net from "node:net";

import { DockerTag } from "./docker-tag.js";
import { GitInfo, type GitInfoType } from "./git-info.js";
import type { Config } from "./lib.js";

const dockerTarget = z.enum(["development", "production"]);
const nodeEnv = z.enum(["test", "development", "production"]).optional();

const buildInfoSchema = z.object({
  repo: z.string(),
  branch: z.string(),
  commit: z.string(),
  version: z.string(),
  tag: z.string(),
  build: z.string(),
  target: z.string(),
});

export type EnvironmentDiffType = {
  added: EnvironmentDiffTupleType[];
  updated: EnvironmentDiffTupleType[];
  removed: EnvironmentDiffTupleType[];
  unchanged: EnvironmentDiffTupleType[];
};
export type EnvironmentDiffTupleType = [string, string | undefined];

const envSchema = z.object({
  DOCKER_ROOT: z.string(),
  DOCKER_PORT: z.string(),
  DOCKER_TAG: z.string(),
  DOCKER_REGISTRY: z.string(),
  DOCKER_IMAGE: z.string(),
  DOCKER_VERSION: z.string(),
  GIT_REPO: z.string(),
  GIT_BRANCH: z.string(),
  GIT_COMMIT: z.string(),
  DOCKER_DIGEST: z.string().optional().default(""),
  DOCKER_TARGET: dockerTarget,
  NODE_ENV: nodeEnv,
});

type SchemaType = z.infer<typeof envSchema>;
export type SchemaTypePartial = Partial<SchemaType>;

function forObjectKeys<T>(obj: T, fn: (key: keyof T) => unknown): void {
  for (const k in obj) {
    const key = k as keyof T;
    fn(key);
  }
}

export class Environment {
  static baseTag = new DockerTag("kevin-mind/nopo:local");

  root: string;
  envFile: string;
  processEnv: Record<string, string>;
  hasPrevEnv: boolean;
  prevEnv: SchemaTypePartial;
  env: SchemaType;
  diff: EnvironmentDiffType;

  constructor({ envFile, processEnv, root }: Config) {
    if (!envFile) {
      throw new Error("Missing envFile");
    }

    this.root = root;
    this.envFile = envFile;
    this.processEnv = processEnv;
    this.hasPrevEnv = fs.existsSync(this.envFile);
    this.prevEnv = this.#getPrevEnv();
    this.env = this.#getCurrEnv();
    this.diff = this.#diff();
  }

  #getPrevEnv() {
    const result = envSchema.safeParse(
      this.hasPrevEnv ? dotenv.load(this.envFile) : {},
    );
    return result.data ?? {};
  }

  #resolveDockerTag(): DockerTag {
    if (this.processEnv.DOCKER_TAG) {
      return new DockerTag(this.processEnv.DOCKER_TAG);
    } else if (this.processEnv.DOCKER_IMAGE && this.processEnv.DOCKER_VERSION) {
      return new DockerTag({
        registry: this.processEnv.DOCKER_REGISTRY || "",
        image: this.processEnv.DOCKER_IMAGE,
        version: this.processEnv.DOCKER_VERSION,
        digest: this.processEnv.DOCKER_DIGEST || "",
      });
    } else if (this.prevEnv.DOCKER_TAG) {
      return new DockerTag(this.prevEnv.DOCKER_TAG);
    } else if (this.prevEnv.DOCKER_IMAGE && this.prevEnv.DOCKER_VERSION) {
      return new DockerTag({
        registry: this.prevEnv.DOCKER_REGISTRY || "",
        image: this.prevEnv.DOCKER_IMAGE,
        version: this.prevEnv.DOCKER_VERSION,
        digest: this.prevEnv.DOCKER_DIGEST || "",
      });
    } else {
      return Environment.baseTag;
    }
  }

  #getBuildInfo() {
    const { data, success } = buildInfoSchema.safeParse(
      fs.existsSync("/build-info.json")
        ? JSON.parse(fs.readFileSync("/build-info.json", "utf8"))
        : null,
    );
    return success ? data : null;
  }

  #resolveGitInfo(inputEnv: SchemaTypePartial): GitInfoType {
    const buildInfo = this.#getBuildInfo();
    if (buildInfo) {
      return GitInfo.parse(buildInfo);
    }
    if (inputEnv.GIT_REPO && inputEnv.GIT_BRANCH && inputEnv.GIT_COMMIT) {
      return GitInfo.parse({
        repo: inputEnv.GIT_REPO,
        branch: inputEnv.GIT_BRANCH,
        commit: inputEnv.GIT_COMMIT,
      });
    }
    return GitInfo.parse();
  }

  #resolveDockerPort(): string {
    if (this.processEnv.DOCKER_PORT) {
      return String(this.processEnv.DOCKER_PORT);
    }

    const server = net.createServer();
    server.listen(0);
    const address = server.address();
    if (address && typeof address === "object" && "port" in address) {
      const freePort = address.port;
      server.close();
      return String(freePort);
    }
    server.close();
    return "80";
  }

  #getCurrEnv(): SchemaType {
    const inputEnv = {
      ...this.prevEnv,
      ...this.processEnv,
    };
    const { parsed, fullTag } = this.#resolveDockerTag();
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
      image = Environment.baseTag.parsed.image;
    } else if (image && !version && digest && !image.includes(":")) {
      version = image;
      image = Environment.baseTag.parsed.image;
    }

    if (digest && !version) {
      throw new Error(
        `Invalid image tag: ${fullTag} (when specifying a digest, a version is required)`,
      );
    }

    if (!registry) {
      registry = Environment.baseTag.parsed.registry;
    }

    const isLocal = version === "local";
    const defaultTarget = isLocal ? "development" : "production";
    const current = inputEnv.DOCKER_TARGET;
    const isMissing = !current;
    const isWrong = !isLocal && current !== defaultTarget;
    if (isMissing || isWrong) {
      inputEnv.DOCKER_TARGET = defaultTarget;
      inputEnv.NODE_ENV = defaultTarget;
    }

    const gitInfo = this.#resolveGitInfo(inputEnv);

    return envSchema.parse({
      DOCKER_ROOT: this.root,
      DOCKER_PORT: this.#resolveDockerPort(),
      DOCKER_TAG: new DockerTag({
        registry,
        image,
        version,
        digest: digest || "",
      }).fullTag,
      DOCKER_TARGET: inputEnv.DOCKER_TARGET,
      DOCKER_REGISTRY: registry,
      DOCKER_IMAGE: image,
      DOCKER_VERSION: version,
      DOCKER_DIGEST: digest || "",
      GIT_REPO: gitInfo.repo,
      GIT_BRANCH: gitInfo.branch,
      GIT_COMMIT: gitInfo.commit,
      NODE_ENV: inputEnv.NODE_ENV,
    });
  }

  #diff(): EnvironmentDiffType {
    const result: EnvironmentDiffType = {
      added: [],
      updated: [],
      removed: [],
      unchanged: [],
    };

    forObjectKeys(envSchema.shape, (key) => {
      const prevValue = this.prevEnv[key];
      const currValue = this.env[key as keyof typeof this.env];

      if (!prevValue && currValue) {
        result.added.push([key, String(currValue)]);
      } else if (prevValue && !currValue) {
        result.removed.push([key, prevValue]);
      } else if (currValue && prevValue !== currValue) {
        result.updated.push([key, String(currValue)]);
      } else if (currValue) {
        result.unchanged.push([key, prevValue]);
      }
    });
    return result;
  }

  save(): void {
    const sortedEnv = Object.entries(this.env)
      .filter(([, value]) => !!value)
      .sort((a, b) => a[0].localeCompare(b[0]));

    const sortedEnvString = sortedEnv
      .map(([key, value]) => `${key}="${value}"`)
      .join("\n");

    fs.writeFileSync(this.envFile, sortedEnvString);
  }
}
