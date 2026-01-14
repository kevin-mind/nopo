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
      `  nopo build -- $SERVICES ${args.join(" ")}`,
      "else",
      `  nopo build -- ${args.join(" ")}`,
      "fi",
    ),
  });
}

/**
 * make -C ./nopo/scripts init - Build the nopo CLI.
 * Note: For most cases, use the setup-nopo action instead.
 */
export function makeNopoInit(
  id?: string,
  opts?: {
    continueOnError?: boolean;
  },
  name?: string,
): Step {
  return new Step({
    ...(id && { id }),
    name: name ?? "Build nopo CLI",
    ...(opts?.continueOnError && { "continue-on-error": opts.continueOnError }),
    run: "make -C ./nopo/scripts init",
  });
}
