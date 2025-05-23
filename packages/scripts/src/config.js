import { fileURLToPath } from "node:url";
import { path, chalk, $ } from "zx";

chalk.level = 2;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..", "..", "..");

$.cwd = root;

const envFile = path.resolve(root, ".env");

export default {
  __filename,
  __dirname,
  root,
  envFile,
};
