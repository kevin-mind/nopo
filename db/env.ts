import { baseSchema, z } from '../env';

const { DATABASE_URL } = baseSchema.shape;

const schema = z.object({
  DATABASE_URL: DATABASE_URL,
})

export default schema.parse(process.env);
