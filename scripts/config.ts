import { path } from "zx";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.join(__dirname, "..");

export const config = {
  root,
  env: path.join(root, ".env"),
} as const;
