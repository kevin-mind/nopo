/**
 * Atomic step generators for Docker CLI commands.
 *
 * Each function generates a Step that executes ONE docker command.
 * For complex multi-step Docker operations, use composite actions in .github/actions/
 */

import { Step, multilineString } from "@github-actions-workflow-ts/lib";

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
