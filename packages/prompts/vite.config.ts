import { defineConfig } from "vite";
import { readdirSync } from "fs";
import { resolve, basename } from "path";

const promptsDir = resolve(__dirname, "src/prompts");
const promptFiles = readdirSync(promptsDir).filter((f) => f.endsWith(".tsx"));

const entry: Record<string, string> = {};
for (const file of promptFiles) {
  const name = basename(file, ".tsx");
  entry[name] = resolve(promptsDir, file);
}

export default defineConfig({
  build: {
    lib: {
      entry,
      formats: ["es"],
    },
    outDir: "dist",
    rollupOptions: {
      external: ["zod", "@more/prompt-factory"],
    },
  },
});
