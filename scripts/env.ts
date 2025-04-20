import { fileURLToPath } from "node:url";
import { parseEnv, z } from "znv";
import { path, fs, dotenv } from "zx";

const env = parseEnv(process.env, {
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  DOCKER_REGISTRY: z.enum(["docker.io", "ghcr.io"]).default("docker.io"),
  DOCKER_IMAGE: z.literal("kevin-mind/nopo").default("kevin-mind/nopo"),
  DOCKER_VERSION: z.string().default("local"),
  DOCKER_TARGET: z.enum(["development", "production"]).default("development"),
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envFile = path.join(__dirname, "..", ".env");

fs.writeFileSync(envFile, dotenv.stringify(env));

export default env;
