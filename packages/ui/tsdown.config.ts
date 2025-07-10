import { defineConfig } from "tsdown";
import { glob } from "glob";

const entry = glob.sync("src/*.ts");

export default defineConfig({
  entry,
  outDir: "build",
  format: ["es"],
  clean: true,
  exports: false,
});
