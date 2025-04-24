import { fileURLToPath } from "node:url";
import { path } from "zx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..", "..");

const envFile = path.resolve(root, ".env");

export default {
  __filename,
  __dirname,
  root,
  envFile,
  env: {
    ...process.env,
  },
};
