#!/usr/bin/env tsx
/**
 * Generate an HTML file to visualize the state machine locally
 *
 * Usage:
 *   pnpm tsx claude-state-machine/scripts/visualize.ts
 *   pnpm tsx claude-state-machine/scripts/visualize.ts --open
 *
 * This creates state-machine.html that can be opened in any browser.
 */

import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { claudeMachine } from "../machine/machine.js";

interface StateNode {
  type?: string;
  entry?: string | string[];
  always?: Array<{
    target?: string;
    guard?: string;
    actions?: string | string[];
  }>;
  on?: Record<
    string,
    | string
    | {
        target?: string;
        guard?: string;
        actions?: string | string[];
      }
    | Array<{
        target?: string;
        guard?: string;
        actions?: string | string[];
      }>
  >;
}

type StatesConfig = Record<string, StateNode>;

function generateMermaidDiagram(): string {
  const lines: string[] = [];

  lines.push("stateDiagram-v2");
  lines.push("    [*] --> detecting");
  lines.push("");

  const config = claudeMachine.config;
  const states = (config.states || {}) as StatesConfig;

  for (const [stateName, stateConfig] of Object.entries(states)) {
    const state = stateConfig as StateNode;

    // Skip notes for cleaner diagram - they cause rendering issues
    // if (state.entry) { ... }

    if (state.always && Array.isArray(state.always)) {
      for (const transition of state.always) {
        if (transition.target) {
          const guard = transition.guard ? `: ${transition.guard}` : "";
          lines.push(`    ${stateName} --> ${transition.target}${guard}`);
        }
      }
    }

    if (state.on) {
      for (const [eventName, eventConfig] of Object.entries(state.on)) {
        if (typeof eventConfig === "string") {
          lines.push(`    ${stateName} --> ${eventConfig}: ${eventName}`);
        } else if (Array.isArray(eventConfig)) {
          for (const transition of eventConfig) {
            if (transition.target) {
              const guard = transition.guard ? ` [${transition.guard}]` : "";
              lines.push(
                `    ${stateName} --> ${transition.target}: ${eventName}${guard}`,
              );
            }
          }
        } else if (eventConfig && typeof eventConfig === "object") {
          const target = eventConfig.target;
          if (target) {
            const guard = eventConfig.guard ? ` [${eventConfig.guard}]` : "";
            lines.push(`    ${stateName} --> ${target}: ${eventName}${guard}`);
          }
        }
      }
    }

    if (state.type === "final") {
      lines.push(`    ${stateName} --> [*]`);
    }
  }

  return lines.join("\n");
}

function generateHTML(): string {
  const mermaidCode = generateMermaidDiagram();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Automation State Machine</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
    }
    .subtitle {
      color: #666;
      margin-bottom: 20px;
    }
    .container {
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow-x: auto;
    }
    .mermaid {
      display: flex;
      justify-content: center;
    }
    .controls {
      margin-bottom: 20px;
    }
    button {
      padding: 8px 16px;
      margin-right: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      background: white;
      cursor: pointer;
    }
    button:hover {
      background: #f0f0f0;
    }
  </style>
</head>
<body>
  <h1>Claude Automation State Machine</h1>
  <p class="subtitle">XState v5 state machine for GitHub issue automation</p>

  <div class="controls">
    <button onclick="zoomIn()">Zoom In</button>
    <button onclick="zoomOut()">Zoom Out</button>
    <button onclick="resetZoom()">Reset</button>
    <button onclick="downloadSVG()">Download SVG</button>
  </div>

  <div class="container">
    <pre class="mermaid" id="diagram">
${mermaidCode}
    </pre>
  </div>

  <script>
    let scale = 1;
    const diagram = document.getElementById('diagram');

    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      securityLevel: 'loose'
    });

    function zoomIn() {
      scale *= 1.2;
      diagram.style.transform = \`scale(\${scale})\`;
    }

    function zoomOut() {
      scale *= 0.8;
      diagram.style.transform = \`scale(\${scale})\`;
    }

    function resetZoom() {
      scale = 1;
      diagram.style.transform = 'scale(1)';
    }

    function downloadSVG() {
      const svg = diagram.querySelector('svg');
      if (svg) {
        const svgData = new XMLSerializer().serializeToString(svg);
        const blob = new Blob([svgData], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'claude-state-machine.svg';
        a.click();
        URL.revokeObjectURL(url);
      }
    }
  </script>
</body>
</html>`;
}

// Main
const args = process.argv.slice(2);
const outputPath = new URL("../state-machine.html", import.meta.url).pathname;

const html = generateHTML();
writeFileSync(outputPath, html);
console.log(`Generated: ${outputPath}`);

if (args.includes("--open")) {
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    execSync(`${cmd} "${outputPath}"`);
    console.log("Opened in browser");
  } catch {
    console.log("Could not open browser automatically");
  }
}
