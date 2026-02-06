import { readdirSync, writeFileSync, mkdirSync } from "fs";
import { resolve, basename } from "path";
import { toJsonSchema } from "@more/prompt-factory";

const root = resolve(import.meta.dirname, "..");
const promptsDir = resolve(root, "src/prompts");
const promptFiles = readdirSync(promptsDir).filter((f) => f.endsWith(".tsx"));

for (const file of promptFiles) {
  const name = basename(file, ".tsx");
  const mod = await import(resolve(promptsDir, file));
  const prompt = mod.default;

  const outDir = resolve(root, "dist", name);
  mkdirSync(outDir, { recursive: true });

  if (prompt.outputSchema) {
    const outputJsonSchema = toJsonSchema(prompt.outputSchema);
    writeFileSync(
      resolve(outDir, "outputs.json"),
      JSON.stringify(outputJsonSchema, null, 2) + "\n",
    );
    console.log(`  wrote ${name}/outputs.json`);
  }

  if (prompt.inputSchema) {
    const inputJsonSchema = toJsonSchema(prompt.inputSchema);
    writeFileSync(
      resolve(outDir, "inputs.json"),
      JSON.stringify(inputJsonSchema, null, 2) + "\n",
    );
    console.log(`  wrote ${name}/inputs.json`);
  }
}

console.log("Schema extraction complete.");
