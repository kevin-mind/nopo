/**
 * Atomic step generators for nopo CLI commands.
 *
 * Each function generates a Step that executes ONE nopo command.
 * For nopo setup (build + global link), use the setup-nopo action.
 */

import { Step, echoKeyValue, multilineString } from "@github-actions-workflow-ts/lib";

/**
 * nopo list - List discovered services.
 */
export function nopoList(
  id: string,
  opts?: {
    json?: boolean;
    jq?: string;
  },
  name?: string,
): Step {
  const args: string[] = ["list"];
  if (opts?.json) args.push("--json");
  if (opts?.jq) args.push(`--jq '${opts.jq}'`);

  return new Step({
    id,
    name: name ?? "nopo list",
    run: multilineString(
      `output=$(nopo ${args.join(" ")})`,
      'echo "$output"',
      echoKeyValue.toGithubOutput("services", "${output}"),
    ),
  });
}

/**
 * nopo test - Run tests for a service.
 */
export function nopoTest(
  env: {
    SERVICE: string;
  },
  name?: string,
): Step {
  return new Step({
    name: name ?? "nopo test",
    env,
    run: 'nopo test "$SERVICE"',
  });
}

/**
 * nopo check - Run checks for a service.
 */
export function nopoCheck(
  env: {
    SERVICE: string;
    SUBCOMMAND?: string;
  },
  name?: string,
): Step {
  return new Step({
    name: name ?? "nopo check",
    env,
    run: env.SUBCOMMAND
      ? 'nopo check "$SUBCOMMAND" "$SERVICE"'
      : 'nopo check "$SERVICE"',
  });
}

/**
 * nopo build - Build service images.
 *
 * Note: --output must come BEFORE targets since nopo uses minimist parsing.
 */
export function nopoBuild(
  env: {
    SERVICES?: string;
    DOCKER_TAG?: string;
    DOCKER_PUSH?: string;
    DOCKER_BUILDER?: string;
  },
  opts?: {
    output?: string;
  },
  name?: string,
): Step {
  const args: string[] = [];
  if (opts?.output) args.push(`--output ${opts.output}`);

  return new Step({
    name: name ?? "nopo build",
    env,
    run: multilineString(
      'if [[ -n "$SERVICES" ]]; then',
      `  nopo build ${args.join(" ")} $SERVICES`,
      "else",
      `  nopo build ${args.join(" ")}`,
      "fi",
    ),
  });
}

// Note: For nopo CLI setup (build + global link), use setupNopoStep from lib/steps.ts
// which uses the setup-nopo composite action.
