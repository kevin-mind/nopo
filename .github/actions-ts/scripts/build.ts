import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const actionsDir = path.dirname(import.meta.dirname);
const isWatch = process.argv.includes("--watch");

interface ActionInfo {
  name: string;
  entryPoint: string;
}

// Find all action directories (those with action.yml and an entry point)
// Entry point can be action-entry.ts (preferred) or index.ts (fallback)
function findActions(): ActionInfo[] {
  const entries = fs.readdirSync(actionsDir, { withFileTypes: true });
  const actions: ActionInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (
      entry.name === "node_modules" ||
      entry.name === "scripts" ||
      entry.name === "lib"
    )
      continue;

    const actionYml = path.join(actionsDir, entry.name, "action.yml");
    const actionEntryTs = path.join(actionsDir, entry.name, "action-entry.ts");
    const indexTs = path.join(actionsDir, entry.name, "index.ts");

    if (!fs.existsSync(actionYml)) continue;

    // Prefer action-entry.ts over index.ts for the build entry point
    if (fs.existsSync(actionEntryTs)) {
      actions.push({ name: entry.name, entryPoint: actionEntryTs });
    } else if (fs.existsSync(indexTs)) {
      actions.push({ name: entry.name, entryPoint: indexTs });
    }
  }

  return actions;
}

async function build() {
  const actions = findActions();

  if (actions.length === 0) {
    console.log("No actions found to build");
    return;
  }

  console.log(
    `Building ${actions.length} actions: ${actions.map((a) => a.name).join(", ")}`,
  );

  const buildConfigs = actions.map((action) => ({
    entryPoints: [action.entryPoint],
    bundle: true,
    platform: "node" as const,
    target: "node20",
    outfile: path.join(actionsDir, action.name, "dist", "index.cjs"),
    format: "cjs" as const,
    sourcemap: true,
    minify: false,
    // Bundle all dependencies into the output
    external: [],
    banner: {
      js: "// This file is auto-generated. Do not edit directly.",
    },
  }));

  if (isWatch) {
    console.log("Watching for changes...");
    const contexts = await Promise.all(
      buildConfigs.map((config) => esbuild.context(config)),
    );
    await Promise.all(contexts.map((ctx) => ctx.watch()));
  } else {
    await Promise.all(buildConfigs.map((config) => esbuild.build(config)));
    console.log("Build complete!");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
