import type { PoolClient } from "pg";
import type {
  AdminSessionRow,
  AdminUserRow,
  AppConfig,
  Message,
  VisitorSession,
} from "@/types";

/*
 * Read queries. Every function receives a client from withDb(), i.e. it runs
 * as the tp_app role with RLS active — a visitor client simply cannot see rows
 * outside its own sessions, whatever the WHERE clause says.
 */

const SESSION_COLS = `id, session_code, created_at, last_activity_at, updated_at, status, message_count, unanswered_count`;
const MESSAGE_COLS = `id, session_id, sender_type, content, created_at, updated_at, delivery_status, client_msg_id`;
const ADMIN_SESSION_COLS = `${SESSION_COLS}, user_id, closed_at, user_name, user_email, user_status, visitor_hidden_at`;

export const PAGE_SIZE = 20;

/** Escapes LIKE wildcards in user input. */
export function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export async function dbNow(c: PoolClient): Promise<string> {
  const { rows } = await c.query<{ now: Date }>("select now() as now");
  return rows[0].now.toISOString();
}

// ----------------------------------------------------------------- visitor ---

export async function listVisitorSessions(c: PoolClient) {
  const { rows } = await c.query<VisitorSession>(
    `select ${SESSION_COLS} from public.sessions order by last_activity_at desc limit 200`,
  );
  return rows;
}

export async function listSessionMessages(c: PoolClient, sessionId: string, limit = 500) {
  const { rows } = await c.query<Message>(
    `select * from (
       select ${MESSAGE_COLS} from public.messages
       where session_id = $1 order by created_at desc limit $2
     ) m order by created_at asc`,
    [sessionId, limit],
  );
  return rows;
}

export async function visitorChangesSince(c: PoolClient, since: string) {
  const messages = await c.query<Message>(
    `select ${MESSAGE_COLS} from public.messages
     where updated_at > $1
       and session_id in (select id from public.sessions where visitor_access_id = private.current_visitor_access_id())
     order by updated_at asc limit 200`,
    [since],
  );
  const sessions = await c.query<VisitorSession>(
    `select ${SESSION_COLS} from public.sessions where updated_at > $1 order by updated_at asc limit 100`,
    [since],
  );
  return { messages: messages.rows, sessions: sessions.rows };
}

// ------------------------------------------------------------------- admin ---

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserFilters {
  q?: string;
  status?: "active" | "blocked";
  sort?: "activity" | "newest" | "name";
  page?: number;
}

export async function listAdminUsers(c: PoolClient, f: UserFilters): Promise<Page<AdminUserRow>> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q) {
    params.push(likePattern(f.q));
    where.push(`(name ilike $${params.length} or email ilike $${params.length})`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`status = $${params.length}::public.user_status`);
  }
  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const order =
    f.sort === "newest" ? "created_at desc" : f.sort === "name" ? "lower(name) asc, email asc" : "last_seen_at desc";
  const page = Math.max(1, f.page ?? 1);

  const total = await c.query<{ n: number }>(`select count(*)::int as n from public.admin_user_list ${whereSql}`, params);
  const { rows } = await c.query<AdminUserRow>(
    `select * from public.admin_user_list ${whereSql} order by ${order}, id
     limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
    params,
  );
  return { rows, total: total.rows[0].n, page, pageSize: PAGE_SIZE };
}

export async function getAdminUser(c: PoolClient, id: string) {
  const { rows } = await c.query<AdminUserRow>(`select * from public.admin_user_list where id = $1`, [id]);
  return rows[0] ?? null;
}

export interface SessionFilters {
  email?: string;
  code?: string;
  status?: "active" | "closed";
  unanswered?: boolean;
  userId?: string;
  from?: string; // ISO date
  to?: string; // ISO date (inclusive day)
  page?: number;
  pageSize?: number;
  sort?: "activity" | "created" | "queue";
}

export async function listAdminSessions(c: PoolClient, f: SessionFilters): Promise<Page<AdminSessionRow>> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.email) add("user_email ilike ?", likePattern(f.email));
  if (f.code) add("session_code ilike ?", likePattern(f.code.toUpperCase()));
  if (f.status) add("status = ?::public.session_status", f.status);
  if (f.unanswered) where.push("unanswered_count > 0");
  if (f.userId) add("user_id = ?::uuid", f.userId);
  if (f.from) add("created_at >= ?::date", f.from);
  if (f.to) add("created_at < (?::date + 1)", f.to);

  const whereSql = where.length ? `where ${where.join(" and ")}` : "";
  const order =
    f.sort === "created"
      ? "created_at desc"
      : f.sort === "queue"
        ? "(unanswered_count > 0) desc, last_activity_at desc"
        : "last_activity_at desc";
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? PAGE_SIZE));

  const total = await c.query<{ n: number }>(
    `select count(*)::int as n from public.admin_session_list ${whereSql}`,
    params,
  );
  const { rows } = await c.query<AdminSessionRow>(
    `select ${ADMIN_SESSION_COLS} from public.admin_session_list ${whereSql}
     order by ${order}, id limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params,
  );
  return { rows, total: total.rows[0].n, page, pageSize };
}

export async function getAdminSessionRow(c: PoolClient, id: string) {
  const { rows } = await c.query<AdminSessionRow>(
    `select ${ADMIN_SESSION_COLS} from public.admin_session_list where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function adminChangesSince(c: PoolClient, since: string) {
  const messages = await c.query<Message>(
    `select ${MESSAGE_COLS} from public.messages where updated_at > $1 order by updated_at asc limit 300`,
    [since],
  );
  const sessions = await c.query<AdminSessionRow>(
    `select ${ADMIN_SESSION_COLS} from public.admin_session_list where updated_at > $1 order by updated_at asc limit 200`,
    [since],
  );
  const users = await c.query<{ id: string; status: string; updated_at: string }>(
    `select id, status, updated_at from public.users where updated_at > $1 order by updated_at asc limit 200`,
    [since],
  );
  return { messages: messages.rows, sessions: sessions.rows, users: users.rows };
}

export async function getAppConfig(c: PoolClient) {
  const { rows } = await c.query<AppConfig>(
    `select message_max_length, rate_limit_per_minute, sessions_per_hour, updated_at from public.app_config where id`,
  );
  return rows[0] ?? null;
}
