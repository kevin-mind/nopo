import { z } from "zod";
import { config } from "dotenv";

const _POSTGRESS_USER = "myuser";
const _POSTGRESS_PASSWORD = "mypassword";
const _POSTGRESS_DB = "mydatabase";

function getDatabaseUrl(
  baseUrl: string,
  user: string,
  password: string,
  db: string,
  port: number,
) {
  return `${baseUrl}://${user}:${password}@db:${port}/${db}?schema=public`;
}

export const baseSchema = z.object({
  DATABASE_URL: z
    .string()
    .default(
      getDatabaseUrl(
        "postgresql",
        _POSTGRESS_USER,
        _POSTGRESS_PASSWORD,
        _POSTGRESS_DB,
        5432,
      ),
    ),
  POSTGRES_DB: z.string().default(_POSTGRESS_DB),
  POSTGRES_USER: z.string().default(_POSTGRESS_USER),
  POSTGRES_PASSWORD: z.string().default(_POSTGRESS_PASSWORD),
  NODE_ENV: z.string().default("development"),
  WEB_DOCKER_TAG: z.string().default("website/web:latest"),
  WEB_DOCKER_TARGET: z.string().default("development"),
});

export { z };

const { parsed } = config();

export default baseSchema.parse(parsed);
