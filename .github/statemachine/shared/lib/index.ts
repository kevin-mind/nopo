import * as core from "@actions/core";
import * as exec from "@actions/exec";

/**
 * Get an input value, returning undefined if empty
 */
function getOptionalInput(name: string): string | undefined {
  const value = core.getInput(name);
  return value === "" ? undefined : value;
}

/**
 * Get a required input value
 */
function getRequiredInput(name: string): string {
  return core.getInput(name, { required: true });
}

/**
 * Execute a command and return the output
 */
async function execCommand(
  command: string,
  args: string[] = [],
  options?: exec.ExecOptions,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let stdout = "";
  let stderr = "";

  const exitCode = await exec.exec(command, args, {
    ...options,
    listeners: {
      stdout: (data) => {
        stdout += data.toString();
      },
      stderr: (data) => {
        stderr += data.toString();
      },
    },
  });

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

/**
 * Parse a .env file content into a key-value object
 */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex);
    let value = trimmed.slice(eqIndex + 1);

    // Remove surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Set multiple outputs from an object
 */
function setOutputs(outputs: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(outputs)) {
    if (value !== undefined) {
      core.setOutput(key, value);
    }
  }
}

// Outcome determination utilities
;
