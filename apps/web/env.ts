import { z } from "zod";
import { parseEnv } from "znv";

export default parseEnv(process.env, {
  NODE_ENV: z.string(),
  SERVICE_PUBLIC_PATH: z.string().default("/"),
  PORT: z.number().default(80),
});
