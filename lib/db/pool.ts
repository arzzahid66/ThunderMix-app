import { Pool, type PoolClient } from "pg";

declare global {
  var __tpPool: Pool | undefined;
}

/**
 * One small pool per server instance. With Neon, point DATABASE_URL at the
 * *pooled* endpoint (host contains "-pooler"), which multiplexes serverless
 * connections through PgBouncer.
 */
export function getPool(): Pool {
  if (!globalThis.__tpPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set. See .env.example.");
    }
    globalThis.__tpPool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    globalThis.__tpPool.on("error", (err) => console.error("[db] idle client error", err.message));
  }
  return globalThis.__tpPool;
}

export interface DbIdentity {
  visitorToken?: string | null;
  adminToken?: string | null;
}

/**
 * Runs `fn` in a transaction as the restricted `tp_app` role with the caller's
 * tokens in transaction-local settings. The database verifies the tokens and
 * Row Level Security scopes every query to what that caller may see.
 */
export async function withDb<T>(identity: DbIdentity, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query(
      "select set_config('tp.visitor_token', $1, true), set_config('tp.admin_token', $2, true)",
      [identity.visitorToken ?? "", identity.adminToken ?? ""],
    );
    await client.query("set local role tp_app");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Convenience: call a single-row function returning jsonb. */
export async function callJson<T>(client: PoolClient, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await client.query(sql, params);
  const first = rows[0] as Record<string, unknown> | undefined;
  return (first ? Object.values(first)[0] : null) as T;
}
