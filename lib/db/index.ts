import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };

// Reason: reuse one pool across Next.js dev hot reloads.
const client =
  globalForDb.pg ?? postgres(env("DATABASE_URL", "postgres://posty:posty@localhost:5432/posty"), { max: 10 });
globalForDb.pg = client;

export const db = drizzle(client, { schema });
export { schema };
export type Db = typeof db;
