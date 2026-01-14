/**
 * Atomic step generators for Docker CLI commands.
 *
 * Each function generates a Step that executes ONE docker command.
 * For complex multi-step Docker operations, use composite actions in .github/actions/
 */

import { Step, echoKeyValue, multilineString } from "@github-actions-workflow-ts/lib";

/**
 * docker pull - Pull an image from a registry.
 */
export function dockerPull(
  env: {
    IMAGE: string;
  },
  name?: string,
): Step {
  return new Step({
    name: name ?? "docker pull",
    env,
    run: 'docker pull "$IMAGE"',
  });
}

/**
 * docker tag - Create a tag TARGET_IMAGE that refers to SOURCE_IMAGE.
 */
export function dockerTag(
  env: {
    SOURCE_IMAGE: string;
    TARGET_IMAGE: string;
  },
  name?: string,
): Step {
  return new Step({
    name: name ?? "docker tag",
    env,
    run: 'docker tag "$SOURCE_IMAGE" "$TARGET_IMAGE"',
  });
}

/**
 * docker push - Push an image to a registry.
 */
export function dockerPush(
  env: {
    IMAGE: string;
  },
  name?: string,
): Step {
  return new Step({
    name: name ?? "docker push",
    env,
    run: 'docker push "$IMAGE"',
  });
}

/**
 * docker create - Create a new container.
 * Returns the container ID in GITHUB_OUTPUT.
 */
export function dockerCreate(
  id: string,
  env: {
    IMAGE: string;
  },
  name?: string,
): Step {
  return new Step({
    id,
    name: name ?? "docker create",
    env,
    run: multilineString(
      'container_id=$(docker create "$IMAGE")',
      echoKeyValue.toGithubOutput("container_id", "${container_id}"),
    ),
  });
}

/**
 * docker cp - Copy files/folders from a container.
 */
export function dockerCp(
  env: {
    CONTAINER_ID: string;
    SOURCE_PATH: string;
    DEST_PATH: string;
  },
  name?: string,
): Step {
  return new Step({
    name: name ?? "docker cp",
    env,
    run: 'docker cp "$CONTAINER_ID:$SOURCE_PATH" "$DEST_PATH"',
  });
}

/**
 * docker rm - Remove a container.
 */
export function dockerRm(
  env: {
    CONTAINER_ID: string;
  },
  name?: string,
): Step {
  return new Step({
    name: name ?? "docker rm",
    env,
    run: 'docker rm "$CONTAINER_ID" > /dev/null',
  });
}

/**
 * docker pull + tag + push - Pull an image, re-tag it, and push.
 * This is a common pattern for promoting images between registries.
 */
export function dockerPullTagPush(
  env: {
    SOURCE_IMAGE: string;
    TARGET_IMAGE: string;
  },
  name?: string,
): Step {
  return new Step({
    name: name ?? "Pull, tag, and push image",
    env,
    run: multilineString(
      'docker pull "$SOURCE_IMAGE"',
      'docker tag "$SOURCE_IMAGE" "$TARGET_IMAGE"',
      'docker push "$TARGET_IMAGE"',
    ),
  });
}
