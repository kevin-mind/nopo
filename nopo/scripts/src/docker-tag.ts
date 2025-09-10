import { z } from "zod";

// Define the Docker tag regex using named capture groups.
// This regex matches a docker tag of the form:
//   image[:version][@sha256:digest]
//
// Breakdown:
// - ^ and $ ensure we match the full string.
// - (?<image>[^:@]+): Matches the image name as anything except ':' and '@'.
// - (?:\:(?<version>(?![\.-])[a-zA-Z0-9_.-]{1,128}))?: Optionally matches ':version' where version must not start with '.' or '-'.
// - (?:@(?<digest>sha256:[a-fA-F0-9]{64}))?: Optionally matches '@sha256:' followed by 64 hexadecimal characters.
const DOCKER_TAG_REGEX =
  /^((?<image>[^:@]+))(?::(?<version>(?![.-])[a-zA-Z0-9_.-]{1,128}))?(?:@(?<digest>sha256:[a-fA-F0-9]{64}))?$/;

const DockerTagParsed = z.object({
  registry: z.string(),
  image: z.string(),
  version: z.string(),
  digest: z.string().optional().default(""),
});

export type DockerTagParsedType = z.infer<typeof DockerTagParsed>;

interface DockerTagInput {
  registry?: string;
  image: string;
  version?: string;
  digest?: string | undefined;
}

export class DockerTag {
  static regex = DOCKER_TAG_REGEX;
  parsed: DockerTagParsedType;
  fullTag: string;

  static parse(fullTag: string): DockerTagParsedType {
    const match = fullTag.match(DockerTag.regex);
    if (!match || !match.groups) {
      throw new Error(`Invalid image tag: ${fullTag}`);
    }

    let registry = "";
    let image = match.groups.image || "";
    const version = match.groups.version || "";
    const digest = match.groups.digest || "";

    if (!image) {
      throw new Error(`Invalid image tag: ${fullTag} (image is required)`);
    }

    if (image === "sha256") {
      throw new Error(
        `Cannot parse image with only a digest: ${fullTag}. Include an image and version`,
      );
    }

    if (image.includes(".") && image.includes("/")) {
      const [newRegistry, ...imageParts] = image.split("/");
      registry = newRegistry || "";
      image = imageParts.join("/");
    }

    return DockerTagParsed.parse({
      registry,
      image,
      version,
      digest: digest || "",
    });
  }

  static stringify({
    registry,
    image,
    version,
    digest,
  }: DockerTagParsedType): string {
    let fullTag = "";
    if (registry) {
      fullTag = `${registry}/${image}`;
    } else {
      fullTag = image;
    }

    if (version) {
      fullTag += `:${version}`;
    }

    if (digest) {
      fullTag += `@${digest}`;
    }

    return fullTag;
  }

  constructor(tag: string | DockerTagInput) {
    if (typeof tag === "string") {
      this.parsed = DockerTag.parse(tag);
    } else if (typeof tag === "object") {
      this.parsed = DockerTagParsed.parse({
        registry: tag.registry || "",
        image: tag.image,
        version: tag.version || "",
        digest: tag.digest,
      });
    } else {
      throw new Error(`Invalid tag: ${tag}`);
    }
    this.fullTag = DockerTag.stringify(this.parsed);
  }
}
