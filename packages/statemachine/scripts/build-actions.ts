import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const actionsDir = path.join(path.dirname(import.meta.dirname), "actions");
const isWatch = process.argv.includes("--watch");

interface ActionInfo {
  name: string;
  entryPoint: string;
  outDir: string;
  /** Optional additional entry points (e.g., post.ts for cleanup) */
  extraEntryPoints?: { entry: string; outFile: string }[];
}

/**
 * Find actions in a directory
 * Entry point can be action-entry.ts (preferred) or index.ts (fallback)
 */
function findActionsInDir(dir: string): ActionInfo[] {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const actions: ActionInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (
      entry.name === "node_modules" ||
      entry.name === "scripts" ||
      entry.name === "lib"
    )
      continue;

    const actionDir = path.join(dir, entry.name);
    const actionYml = path.join(actionDir, "action.yml");
    const actionEntryTs = path.join(actionDir, "action-entry.ts");
    const indexTs = path.join(actionDir, "index.ts");

    if (!fs.existsSync(actionYml)) continue;

    // Prefer action-entry.ts over index.ts for the build entry point
    const mainEntry = fs.existsSync(actionEntryTs)
      ? actionEntryTs
      : fs.existsSync(indexTs)
        ? indexTs
        : null;

    if (!mainEntry) continue;

    // Detect extra entry points (e.g., post.ts for cleanup actions)
    const extraEntryPoints: ActionInfo["extraEntryPoints"] = [];
    const postTs = path.join(actionDir, "post.ts");
    if (fs.existsSync(postTs)) {
      extraEntryPoints.push({
        entry: postTs,
        outFile: path.join(actionDir, "dist", "post.cjs"),
      });
    }

    actions.push({
      name: entry.name,
      entryPoint: mainEntry,
      outDir: path.join(actionDir, "dist"),
      extraEntryPoints:
        extraEntryPoints.length > 0 ? extraEntryPoints : undefined,
    });
  }

  return actions;
}

function findActions(): ActionInfo[] {
  return findActionsInDir(actionsDir);
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

  const sharedConfig = {
    bundle: true,
    platform: "node" as const,
    target: "node20",
    format: "cjs" as const,
    sourcemap: true,
    minify: false,
    external: [] satisfies string[],
    banner: {
      js: "// This file is auto-generated. Do not edit directly.",
    },
  };

  const buildConfigs = actions.flatMap((action) => {
    const configs = [
      {
        ...sharedConfig,
        entryPoints: [action.entryPoint],
        outfile: path.join(action.outDir, "index.cjs"),
      },
    ];

    for (const extra of action.extraEntryPoints ?? []) {
      configs.push({
        ...sharedConfig,
        entryPoints: [extra.entry],
        outfile: extra.outFile,
      });
    }

    return configs;
  });

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
