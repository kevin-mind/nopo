import { z } from 'zod';

export const baseSchema = z.object({
  DATABASE_URL: z.string().optional(),
  POSTGRES_DB: z.string(),
  POSTGRES_USER: z.string(),
  POSTGRES_PASSWORD: z.string(),
  NODE_ENV: z.string(),
  WEB_DOCKER_TAG: z.string(),
  WEB_DOCKER_TARGET: z.string(),
});

export {
  z
}
