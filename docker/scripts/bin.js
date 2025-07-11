#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const indexPath = join(__dirname, "index.js");

// Get all arguments passed to the script
const args = process.argv.slice(2);

// Spawn zx with the index.js file and all arguments
const child = spawn("npx", ["zx", "--install", indexPath, ...args], {
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => {
  process.exit(code);
});
