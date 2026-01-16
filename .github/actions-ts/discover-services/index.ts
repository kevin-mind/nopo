import * as core from "@actions/core";
import { execCommand, getOptionalInput, setOutputs } from "../lib/index.js";

interface DiscoverServicesInputs {
  filter?: string;
  since?: string;
}

interface DiscoverServicesOutputs extends Record<string, string> {
  services: string;
  services_json: string;
}

interface NopoListOutput {
  services: Record<string, unknown>;
}

function getInputs(): DiscoverServicesInputs {
  return {
    filter: getOptionalInput("filter"),
    since: getOptionalInput("since"),
  };
}

async function run(): Promise<void> {
  try {
    const inputs = getInputs();

    core.info("=== Service Discovery ===");
    core.info(`Filter: ${inputs.filter ?? "<none>"}`);
    core.info(`Since: ${inputs.since ?? "<none>"}`);
    core.info(`Ref: ${process.env.GITHUB_REF ?? "main"}`);

    // Build the command arguments
    const args = ["list", "--", "--json"];
    if (inputs.filter) {
      args.push("--filter", inputs.filter);
    }
    if (inputs.since) {
      args.push("--since", inputs.since);
    }

    core.info(`Command: make ${args.join(" ")}`);
    core.info("");

    // Run the command
    const result = await execCommand("make", args);

    if (result.exitCode !== 0) {
      throw new Error(
        `make list failed with exit code ${result.exitCode}: ${result.stderr}`,
      );
    }

    // Parse the JSON output
    let fullJson: NopoListOutput;
    try {
      fullJson = JSON.parse(result.stdout);
    } catch {
      throw new Error(`Failed to parse JSON output: ${result.stdout}`);
    }

    // Extract service names from JSON
    const serviceNames = Object.keys(fullJson.services ?? {});
    const servicesJson = JSON.stringify(serviceNames);
    const services = serviceNames.join(" ");
    const count = serviceNames.length;

    // Set outputs
    const outputs: DiscoverServicesOutputs = {
      services,
      services_json: servicesJson,
    };

    setOutputs(outputs);

    core.info("=== Result ===");
    core.info(`Discovered ${count} service(s): ${servicesJson}`);

    if (count === 0) {
      core.notice("No services matched the filter criteria");
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

run();
