import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { callJson, withDb, type DbIdentity } from "@/lib/db/pool";
import { migrate } from "../../scripts/migrate.mjs";

export const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54329/terminal_portal_test";

if (/neon\.tech/.test(TEST_URL)) {
  throw new Error("Refusing to run destructive integration tests against a Neon database.");
}

/** Superuser pool: setup and inspection only (bypasses RLS). */
export const owner = new Pool({ connectionString: TEST_URL, max: 4 });
// Route the application's withDb() through the test database.
globalThis.__tpPool = new Pool({ connectionString: TEST_URL, max: 8 });

export const ADMIN_EMAIL = "admin@test.local";
export const ADMIN_PASSWORD = "TestAdmin#2026";

export async function resetDatabase() {
  await owner.query("drop schema if exists private cascade; drop schema if exists public cascade; create schema public;");
  await migrate(TEST_URL, { log: () => undefined });
  await owner.query("select private.upsert_admin($1, $2, 'Test Operator', 'super_admin')", [ADMIN_EMAIL, ADMIN_PASSWORD]);
}

export function newToken() {
  return randomBytes(32).toString("base64url");
}

export function uniqueEmail(tag = "visitor") {
  return `${tag}.${randomUUID().slice(0, 8)}@example.test`;
}

export interface DbError {
  message: string;
  detail?: string;
  code?: string;
}

export type Attempt<T> = { data: T; error: null } | { data: null; error: DbError };

export async function attempt<T>(identity: DbIdentity, sql: string, params: unknown[] = []): Promise<Attempt<T>> {
  try {
    const data = await withDb(identity, (c) => callJson<T>(c, sql, params));
    return { data, error: null };
  } catch (e) {
    const err = e as DbError;
    return { data: null, error: { message: err.message, detail: err.detail, code: err.code } };
  }
}

export async function rows<T = Record<string, unknown>>(identity: DbIdentity, sql: string, params: unknown[] = []) {
  return withDb(identity, async (c) => (await c.query(sql, params)).rows as T[]);
}

export async function register(token: string, name: string, email: string) {
  const result = await attempt<{ user: { name: string; is_new: boolean }; session: { id: string; session_code: string } }>(
    { visitorToken: token },
    "select public.visitor_register($1, $2)",
    [name, email],
  );
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export function send(token: string, sessionId: string, content: string, clientMsgId: string = randomUUID()) {
  return attempt<Record<string, unknown>>(
    { visitorToken: token },
    "select public.visitor_send_message($1, $2, $3)",
    [sessionId, content, clientMsgId],
  );
}

export async function adminToken(): Promise<string> {
  const token = newToken();
  const result = await attempt<Record<string, unknown>>({}, "select public.admin_login($1, $2, $3)", [
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    token,
  ]);
  if (result.error || !result.data || "error" in result.data) throw new Error("admin login failed");
  return token;
}
