#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const buildEntry = path.join(__dirname, "build", "index.js");
const srcEntry = path.join(__dirname, "src", "index.ts");

async function loadModule() {
  if (fs.existsSync(buildEntry)) {
    return import(pathToFileURL(buildEntry).href);
  }

  await import("tsx/esm");
  return import(pathToFileURL(srcEntry).href);
}

loadModule()
  .then(({ default: main }) => main())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
