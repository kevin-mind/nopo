#!/usr/bin/env tsx
/**
 * Generate Mermaid state diagram from the Claude automation state machine
 *
 * Usage:
 *   pnpm tsx scripts/generate-diagram.ts
 *   pnpm tsx scripts/generate-diagram.ts > state-diagram.mmd
 *   pnpm tsx scripts/generate-diagram.ts --format markdown
 */

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

  // Get states from machine config
  const config = claudeMachine.config;
  const states = (config.states || {}) as StatesConfig;

  // Process each state
  for (const [stateName, stateConfig] of Object.entries(states)) {
    const state = stateConfig as StateNode;

    // Add state description as note if it has entry actions
    if (state.entry) {
      const entryActions = Array.isArray(state.entry)
        ? state.entry.join(", ")
        : state.entry;
      lines.push(`    note right of ${stateName}: entry: ${entryActions}`);
    }

    // Process "always" transitions (immediate/transient)
    if (state.always && Array.isArray(state.always)) {
      for (const transition of state.always) {
        if (transition.target) {
          const guard = transition.guard ? `: ${transition.guard}` : "";
          const actions = transition.actions
            ? ` [${Array.isArray(transition.actions) ? transition.actions.join(", ") : transition.actions}]`
            : "";
          lines.push(
            `    ${stateName} --> ${transition.target}${guard}${actions}`,
          );
        }
      }
    }

    // Process event-driven transitions
    if (state.on) {
      for (const [eventName, eventConfig] of Object.entries(state.on)) {
        if (typeof eventConfig === "string") {
          // Simple transition: event -> target
          lines.push(`    ${stateName} --> ${eventConfig}: ${eventName}`);
        } else if (Array.isArray(eventConfig)) {
          // Multiple transitions for same event
          for (const transition of eventConfig) {
            if (transition.target) {
              const guard = transition.guard ? ` [${transition.guard}]` : "";
              lines.push(
                `    ${stateName} --> ${transition.target}: ${eventName}${guard}`,
              );
            }
          }
        } else if (eventConfig && typeof eventConfig === "object") {
          // Single transition with config
          const target = eventConfig.target;
          if (target) {
            const guard = eventConfig.guard ? ` [${eventConfig.guard}]` : "";
            lines.push(`    ${stateName} --> ${target}: ${eventName}${guard}`);
          }
        }
      }
    }

    // Mark final states
    if (state.type === "final") {
      lines.push(`    ${stateName} --> [*]`);
    }
  }

  return lines.join("\n");
}

function generateMarkdownWithDiagram(): string {
  const diagram = generateMermaidDiagram();

  return `# Claude Automation State Machine

## State Diagram

\`\`\`mermaid
${diagram}
\`\`\`

## States

| State | Type | Entry Actions |
|-------|------|---------------|
${generateStateTable()}

## Transitions

${generateTransitionList()}

---
*Generated from machine definition*
`;
}

function generateStateTable(): string {
  const config = claudeMachine.config;
  const states = (config.states || {}) as StatesConfig;
  const rows: string[] = [];

  for (const [stateName, stateConfig] of Object.entries(states)) {
    const state = stateConfig as StateNode;
    const type = state.type === "final" ? "final" : "normal";
    const entry = state.entry
      ? Array.isArray(state.entry)
        ? state.entry.join(", ")
        : state.entry
      : "-";
    rows.push(`| ${stateName} | ${type} | ${entry} |`);
  }

  return rows.join("\n");
}

function generateTransitionList(): string {
  const config = claudeMachine.config;
  const states = (config.states || {}) as StatesConfig;
  const sections: string[] = [];

  for (const [stateName, stateConfig] of Object.entries(states)) {
    const state = stateConfig as StateNode;
    const transitions: string[] = [];

    if (state.always && Array.isArray(state.always)) {
      for (const t of state.always) {
        if (t.target) {
          const guard = t.guard ? ` (guard: ${t.guard})` : "";
          transitions.push(`- → **${t.target}**${guard}`);
        }
      }
    }

    if (state.on) {
      for (const [event, eventConfig] of Object.entries(state.on)) {
        if (typeof eventConfig === "string") {
          transitions.push(`- on ${event} → **${eventConfig}**`);
        } else if (Array.isArray(eventConfig)) {
          for (const t of eventConfig) {
            if (t.target) {
              const guard = t.guard ? ` (guard: ${t.guard})` : "";
              transitions.push(`- on ${event} → **${t.target}**${guard}`);
            }
          }
        } else if (eventConfig?.target) {
          const guard = eventConfig.guard
            ? ` (guard: ${eventConfig.guard})`
            : "";
          transitions.push(`- on ${event} → **${eventConfig.target}**${guard}`);
        }
      }
    }

    if (transitions.length > 0) {
      sections.push(`### ${stateName}\n\n${transitions.join("\n")}`);
    }
  }

  return sections.join("\n\n");
}

// Main execution
const args = process.argv.slice(2);
const format = args.includes("--format")
  ? args[args.indexOf("--format") + 1]
  : "mermaid";

if (format === "markdown") {
  console.log(generateMarkdownWithDiagram());
} else {
  console.log(generateMermaidDiagram());
}
