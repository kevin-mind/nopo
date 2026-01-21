/**
 * Generate documentation from the Claude state machine.
 *
 * This script:
 * 1. Generates a Mermaid diagram from the machine definition
 * 2. Exports the machine definition as JSON
 * 3. Updates the state diagram in the documentation
 *
 * Run with: pnpm docs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const actionsDir = path.dirname(__dirname);
const docsDir = path.join(actionsDir, "..", "docs");
const machineDir = path.join(actionsDir, "claude-state-machine");

async function generateDiagram(): Promise<string> {
  // Import the machine and generate Mermaid diagram
  const { claudeMachine } = await import(
    "../claude-state-machine/machine/machine.js"
  );

  const lines: string[] = ["stateDiagram-v2", "    [*] --> detecting", ""];

  // Get all states and their transitions
  const config = claudeMachine.config;

  if (config.states) {
    for (const [stateName, stateConfig] of Object.entries(config.states)) {
      if (stateConfig && typeof stateConfig === "object" && "on" in stateConfig) {
        const on = stateConfig.on as Record<string, unknown>;
        for (const [, targetConfig] of Object.entries(on)) {
          if (Array.isArray(targetConfig)) {
            for (const transition of targetConfig) {
              if (transition.target) {
                const guardName = transition.guard || "";
                const label = guardName ? `: ${guardName}` : "";
                lines.push(`    ${stateName} --> ${transition.target}${label}`);
              }
            }
          } else if (typeof targetConfig === "object" && targetConfig !== null) {
            const target = (targetConfig as { target?: string }).target;
            if (target) {
              const guardName = (targetConfig as { guard?: string }).guard || "";
              const label = guardName ? `: ${guardName}` : "";
              lines.push(`    ${stateName} --> ${target}${label}`);
            }
          }
        }
      }

      // Check for 'always' transitions
      if (stateConfig && typeof stateConfig === "object" && "always" in stateConfig) {
        const always = stateConfig.always as Array<{ target?: string; guard?: string }> | { target?: string; guard?: string };
        const alwaysArray = Array.isArray(always) ? always : [always];
        for (const transition of alwaysArray) {
          if (transition.target) {
            const guardName = transition.guard || "";
            const label = guardName ? `: ${guardName}` : ": always";
            lines.push(`    ${stateName} --> ${transition.target}${label}`);
          }
        }
      }

      // Mark final states
      if (stateConfig && typeof stateConfig === "object" && "type" in stateConfig && stateConfig.type === "final") {
        lines.push(`    ${stateName} --> [*]: final`);
      }
    }
  }

  return lines.join("\n");
}

async function exportMachineJson(): Promise<string> {
  const { claudeMachine } = await import(
    "../claude-state-machine/machine/machine.js"
  );

  const exportData = {
    id: claudeMachine.config.id,
    version: "1.0.0",
    description: "Claude automation state machine for issue lifecycle management",
    generatedAt: new Date().toISOString(),
    config: claudeMachine.config,
  };

  return JSON.stringify(exportData, null, 2);
}

async function updateDocumentation(diagram: string): Promise<void> {
  const docPath = path.join(docsDir, "claude-state-machine.md");

  if (!fs.existsSync(docPath)) {
    console.log("Documentation file not found, skipping update");
    return;
  }

  let content = fs.readFileSync(docPath, "utf-8");

  // Find and replace the mermaid diagram section
  const mermaidStart = "```mermaid";
  const mermaidEnd = "```";

  // Find the State Diagram section and update it
  const stateDiagramHeader = "## State Diagram";
  const headerIndex = content.indexOf(stateDiagramHeader);

  if (headerIndex === -1) {
    console.log("State Diagram section not found, skipping update");
    return;
  }

  // Find the mermaid block after the header
  const afterHeader = content.substring(headerIndex);
  const mermaidBlockStart = afterHeader.indexOf(mermaidStart);

  if (mermaidBlockStart === -1) {
    console.log("Mermaid block not found, skipping update");
    return;
  }

  // Find the end of the mermaid block
  const mermaidContentStart =
    headerIndex + mermaidBlockStart + mermaidStart.length;
  const remainingContent = content.substring(mermaidContentStart);
  const mermaidBlockEnd = remainingContent.indexOf(mermaidEnd);

  if (mermaidBlockEnd === -1) {
    console.log("Mermaid block end not found, skipping update");
    return;
  }

  // Replace the diagram
  const before = content.substring(0, mermaidContentStart);
  const after = content.substring(mermaidContentStart + mermaidBlockEnd);

  content = before + "\n" + diagram + "\n" + after;

  fs.writeFileSync(docPath, content);
  console.log(`Updated state diagram in ${docPath}`);
}

async function main() {
  console.log("Generating documentation...");

  // Ensure docs directory exists
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  try {
    // Generate Mermaid diagram
    console.log("Generating Mermaid diagram...");
    const diagram = await generateDiagram();

    // Save standalone diagram file
    const diagramPath = path.join(machineDir, "state-diagram.mmd");
    fs.writeFileSync(diagramPath, diagram);
    console.log(`Saved diagram to ${diagramPath}`);

    // Update documentation
    await updateDocumentation(diagram);

    // Export machine definition as JSON
    console.log("Exporting machine definition...");
    const machineJson = await exportMachineJson();
    const jsonPath = path.join(actionsDir, "..", "machine.json");
    fs.writeFileSync(jsonPath, machineJson);
    console.log(`Saved machine definition to ${jsonPath}`);

    console.log("Documentation generation complete!");
  } catch (error) {
    console.error("Error generating documentation:", error);
    // Don't fail the build if docs generation fails
    console.log("Continuing without documentation generation...");
  }
}

main();
