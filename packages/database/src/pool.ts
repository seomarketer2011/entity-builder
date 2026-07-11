/**
 * Postgres pool for trusted backend processes (worker, server routes).
 * Connects with DATABASE_URL (service context — bypasses RLS), so every
 * query in this package takes explicit tenant/site scoping parameters.
 */

import pg from "pg";

let pool: pg.Pool | undefined;

export function getPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new pg.Pool({ connectionString, max: 10 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}
