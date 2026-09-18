import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// DATABASE_URL is not required at import time (postgres.js connects lazily
// on first query), so the app can build/run before Supabase is wired up.
const connectionString = process.env.DATABASE_URL ?? "";

// Next.js dev mode re-evaluates this module on every Fast Refresh, which would
// otherwise open a brand new postgres.js connection pool each time without ever
// closing the previous one — over a long dev session those leaked connections
// pile up against Supabase's pooler connection limit, eventually making every
// query queue for minutes until the dev server is restarted. Caching the client
// on globalThis makes Fast Refresh reuse the same pool instead of leaking a new
// one (standard pattern for any pooled DB client under Next.js dev HMR).
const globalForDb = globalThis as unknown as { __dbClient?: ReturnType<typeof postgres> };

const client = globalForDb.__dbClient ?? postgres(connectionString, { prepare: false });
if (process.env.NODE_ENV !== "production") {
  globalForDb.__dbClient = client;
}

export const db = drizzle(client, { schema });
