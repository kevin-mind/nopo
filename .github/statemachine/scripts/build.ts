import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const statemachineDir = path.dirname(import.meta.dirname);
const isWatch = process.argv.includes("--watch");

interface ActionInfo {
  name: string;
  entryPoint: string;
  outDir: string;
}

/**
 * Recursively find all action directories (those with action.yml and an entry point)
 */
function findActionsRecursive(
  dir: string,
  basePath: string = "",
): ActionInfo[] {
  const actions: ActionInfo[] = [];

  if (!fs.existsSync(dir)) return actions;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (
      entry.name === "node_modules" ||
      entry.name === "scripts" ||
      entry.name === "dist" ||
      entry.name === "__tests__" ||
      entry.name === "fixtures" ||
      entry.name === "prompts"
    )
      continue;

    const subDir = path.join(dir, entry.name);
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const actionYml = path.join(subDir, "action.yml");
    const actionEntryTs = path.join(subDir, "action-entry.ts");
    const indexTs = path.join(subDir, "index.ts");

    if (fs.existsSync(actionYml)) {
      // This directory is an action - find its entry point
      if (fs.existsSync(actionEntryTs)) {
        actions.push({
          name: relativePath,
          entryPoint: actionEntryTs,
          outDir: path.join(subDir, "dist"),
        });
      } else if (fs.existsSync(indexTs)) {
        actions.push({
          name: relativePath,
          entryPoint: indexTs,
          outDir: path.join(subDir, "dist"),
        });
      }
    }

    // Always recurse into subdirectories to find nested actions
    actions.push(...findActionsRecursive(subDir, relativePath));
  }

  return actions;
}

async function build() {
  const actions = findActionsRecursive(statemachineDir);

  if (actions.length === 0) {
    console.log("No actions found to build");
    return;
  }

  console.log(
    `Building ${actions.length} actions:\n${actions.map((a) => `  - ${a.name}`).join("\n")}`,
  );

  const buildConfigs = actions.map((action) => ({
    entryPoints: [action.entryPoint],
    bundle: true,
    platform: "node" as const,
    target: "node20",
    outfile: path.join(action.outDir, "index.cjs"),
    format: "cjs" as const,
    sourcemap: true,
    minify: false,
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
