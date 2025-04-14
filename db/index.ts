import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";

export * from "drizzle-orm";

import env from "./env";

const db = drizzle(env.DATABASE_URL);

export default db;
