import { readdirSync, writeFileSync, mkdirSync } from "fs";
import { resolve, basename } from "path";

const root = resolve(import.meta.dirname, "..");
const promptsDir = resolve(root, "src/prompts");
const promptFiles = readdirSync(promptsDir).filter((f) => f.endsWith(".tsx"));

const outDir = resolve(root, "prompts");
mkdirSync(outDir, { recursive: true });

for (const file of promptFiles) {
  const name = basename(file, ".tsx");
  const mod = await import(resolve(promptsDir, file));
  const prompt = mod.default;

  const template = prompt.renderTemplate();
  writeFileSync(resolve(outDir, `${name}.txt`), template + "\n");
  console.log(`  wrote prompts/${name}.txt`);
}

console.log("Template rendering complete.");
