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

export class DockerTag {
  static regex = DOCKER_TAG_REGEX;

  fullTag = "";
  parsed = {
    registry: "",
    image: "",
    version: "",
    digest: "",
  };

  static parse(fullTag) {
    const match = fullTag.match(DockerTag.regex);
    if (!match || !match.groups) {
      throw new Error(`Invalid image tag: ${fullTag}`);
    }

    let registry = "";
    let { image = "", version = "", digest = "" } = match.groups;

    if (!image) {
      throw new Error(`Invalid image tag: ${fullTag} (image is required)`);
    }

    if (image.includes(".") && image.includes("/")) {
      [registry, ...image] = image.split("/");
      image = image.join("/");
    }

    return { registry, image, version, digest };
  }

  static stringify({ registry, image, version, digest } = this.parsed) {
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
      fullTag += `@sha256:${digest}`;
    }

    return fullTag;
  }

  constructor(tag) {
    this.update(tag);
  }

  update(tag) {
    if (typeof tag === "string") {
      this.parsed = DockerTag.parse(tag);
    } else if (typeof tag === "object") {
      this.parsed = tag;
    } else {
      throw new Error(`Invalid tag: ${tag}`);
    }
    this.fullTag = DockerTag.stringify(this.parsed);
  }
}
