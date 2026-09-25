import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  adminToken,
  attempt,
  newToken,
  owner,
  createUser,
  login,
  newKey,
  register,
  resetDatabase,
  rows,
  send,
  TEST_URL,
} from "./helpers";

let admin: string;

beforeAll(async () => {
  await resetDatabase();
  admin = await adminToken();
});

afterAll(async () => {
  await owner.end();
  await globalThis.__tpPool?.end();
});

describe("private key login & identity", () => {
  it("admins create users; the key signs in and opens a session", async () => {
    const key = newKey();
    const created = await attempt<string>({ adminToken: admin }, "select public.admin_create_user($1, $2)", [
      "  Ada   Lovelace ",
      key,
    ]);
    expect(created.error).toBeNull();

    const result = await login(newToken(), key);
    expect(result.data?.user).toEqual({ name: "Ada Lovelace" });
    expect(result.data?.session.session_code).toMatch(/^SESS_[A-Z0-9]{6}$/);
    const { rows: users } = await owner.query("select name, key_hint from users where id = $1", [created.data]);
    expect(users).toEqual([{ name: "Ada Lovelace", key_hint: key.slice(-4) }]);
  });

  it("accepts the key in any case and with surrounding spaces", async () => {
    const { key } = await createUser("Case");
    expect((await login(newToken(), `  ${key.toUpperCase()} `)).error).toBeNull();
  });

  it("stores only hashes of the key and the browser token", async () => {
    const token = newToken();
    const { key } = await register(token, "Hash");
    expect((await owner.query("select 1 from users where access_key_hash = $1", [key])).rows).toHaveLength(0);
    const { rows: keyHashed } = await owner.query(
      "select 1 from users where access_key_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')",
      [key],
    );
    expect(keyHashed).toHaveLength(1);
    const { rows: found } = await owner.query("select token_hash from visitor_access where token_hash = $1", [token]);
    expect(found).toHaveLength(0);
    const { rows: hashed } = await owner.query(
      "select 1 from visitor_access where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')",
      [token],
    );
    expect(hashed).toHaveLength(1);
  });

  it("rejects malformed and unknown keys and missing/short tokens", async () => {
    const t = newToken();
    expect((await login(t, "a".repeat(63))).error?.message).toBe("TP:invalid_key");
    expect((await login(t, "z".repeat(64))).error?.message).toBe("TP:invalid_key");
    expect((await login(t, newKey())).error?.message).toBe("TP:invalid_key");
    const { key } = await createUser("NoToken");
    const q = "select public.visitor_login($1)";
    expect((await attempt({}, q, [key])).error?.message).toBe("TP:not_authenticated");
    expect((await attempt({ visitorToken: "short" }, q, [key])).error?.message).toBe("TP:not_authenticated");
  });

  it("only admins can create users or regenerate keys", async () => {
    const visitor = { visitorToken: newToken() };
    const create = await attempt(visitor, "select public.admin_create_user('X', $1)", [newKey()]);
    expect(create.error?.message).toBe("TP:forbidden");
    const { id } = await createUser("Target");
    const regen = await attempt(visitor, "select public.admin_regenerate_key($1, $2)", [id, newKey()]);
    expect(regen.error?.message).toBe("TP:forbidden");
    const bad = await attempt({ adminToken: admin }, "select public.admin_create_user('X', 'not-a-key')");
    expect(bad.error?.message).toBe("TP:invalid_key");
  });

  it("refuses to link one browser token to a second user", async () => {
    const token = newToken();
    await register(token, "One");
    const { key } = await createUser("Two");
    expect((await login(token, key)).error?.message).toBe("TP:identity_mismatch");
  });

  it("regenerating a key revokes the old key and every browser that used it", async () => {
    const token = newToken();
    const { userId, key, session } = await register(token, "Rotate");
    const fresh = newKey();
    const res = await attempt({ adminToken: admin }, "select public.admin_regenerate_key($1, $2)", [userId, fresh]);
    expect(res.error).toBeNull();

    expect(await rows({ visitorToken: token }, "select id from sessions")).toHaveLength(0);
    expect((await send(token, session.id, "still here?")).error?.message).toBe("TP:no_access");
    expect((await login(newToken(), key)).error?.message).toBe("TP:invalid_key");
    expect((await login(newToken(), fresh)).error).toBeNull();
  });

  it("signing in again reuses the open conversation; a closed one is replaced", async () => {
    const first = await register(newToken(), "Again");
    const again = await login(newToken(), first.key);
    expect(again.data?.session.id).toBe(first.session.id);

    await attempt({ adminToken: admin }, "select public.admin_set_session_status($1, 'closed')", [first.session.id]);
    const fresh = await login(newToken(), first.key);
    expect(fresh.data?.session.id).not.toBe(first.session.id);
  });

  it("revoked tokens (exit) lose access", async () => {
    const token = newToken();
    const { session } = await register(token, "Exit");
    await attempt({ visitorToken: token }, "select public.visitor_logout()");
    expect(await rows({ visitorToken: token }, "select id from sessions")).toHaveLength(0);
    expect((await send(token, session.id, "hi")).error?.message).toBe("TP:no_access");
  });
});

describe("row level security", () => {
  const tokenA = newToken();
  const tokenA2 = newToken();
  const tokenB = newToken();
  let sessionA: string;
  let keyA: string;

  beforeAll(async () => {
    const a = await register(tokenA, "Alice");
    sessionA = a.session.id;
    keyA = a.key;
    expect((await send(tokenA, sessionA, "private message from A")).error).toBeNull();
    // Alice signs in again on a second device; Mallory is a different user.
    await register(tokenA2, "Alice", keyA);
    await register(tokenB, "Mallory");
  });

  it("callers without a credential can read nothing", async () => {
    for (const table of ["users", "sessions", "messages", "admin_profiles", "app_config", "admin_session_list", "admin_user_list"]) {
      expect(await rows({}, `select * from ${table} limit 5`), table).toHaveLength(0);
    }
    for (const table of ["visitor_access", "admin_sessions"]) {
      await expect(rows({}, `select * from ${table}`), table).rejects.toThrow(/permission denied/);
    }
  });

  it("forged or unknown tokens see nothing", async () => {
    const forged = { visitorToken: newToken(), adminToken: newToken() };
    expect(await rows(forged, "select * from messages")).toHaveLength(0);
    expect(await rows(forged, "select * from users")).toHaveLength(0);
  });

  it("another user never sees someone else's conversation", async () => {
    const sessions = await rows<{ id: string }>({ visitorToken: tokenB }, "select id from sessions");
    expect(sessions.map((s) => s.id)).not.toContain(sessionA);
    expect(await rows({ visitorToken: tokenB }, "select * from messages where session_id = $1", [sessionA])).toHaveLength(0);
    expect(await rows({ visitorToken: tokenB }, "select * from users")).toHaveLength(0);
  });

  it("the same key on another device continues the same conversation", async () => {
    const sessions = await rows<{ id: string }>({ visitorToken: tokenA2 }, "select id from sessions");
    expect(sessions.map((s) => s.id)).toEqual([sessionA]);
    expect(await rows({ visitorToken: tokenA2 }, "select content from messages")).toEqual([
      { content: "private message from A" },
    ]);
  });

  it("the owner can read their own session and messages", async () => {
    const sessions = await rows<{ id: string }>({ visitorToken: tokenA }, "select id from sessions");
    expect(sessions.map((s) => s.id)).toEqual([sessionA]);
    expect(await rows({ visitorToken: tokenA }, "select content from messages")).toEqual([
      { content: "private message from A" },
    ]);
  });

  it("visitors cannot post into someone else's session", async () => {
    expect((await send(tokenB, sessionA, "injected")).error?.message).toBe("TP:session_not_found");
  });

  it("visitors cannot write tables directly", async () => {
    const id = { visitorToken: tokenA };
    await expect(
      rows(id, "insert into messages (session_id, sender_type, content) values ($1, 'admin', 'forged')", [sessionA]),
    ).rejects.toThrow(/permission denied/);
    await expect(rows(id, "update sessions set status = 'closed' where id = $1", [sessionA])).rejects.toThrow(
      /permission denied/,
    );
    await expect(rows(id, "delete from messages")).rejects.toThrow(/permission denied/);
    await expect(
      rows(id, "insert into admin_profiles (email, password_hash, display_name) values ('x@y.z', 'x', 'x')"),
    ).rejects.toThrow(/permission denied/);
    // Deletes are granted for admins only; RLS makes them no-ops for visitors.
    expect(await rows(id, "delete from users returning id")).toHaveLength(0);
    expect(await rows(id, "delete from sessions returning id")).toHaveLength(0);
  });

  it("a tp_app login connection cannot escape RLS, even with RESET ROLE", async () => {
    await owner.query("alter role tp_app with login password 'tp_app_test_password'");
    const url = new URL(TEST_URL);
    url.username = "tp_app";
    url.password = "tp_app_test_password";
    const restricted = new Client({ connectionString: url.toString() });
    await restricted.connect();
    try {
      await restricted.query("reset role");
      expect((await restricted.query("select * from users")).rows).toHaveLength(0);
      expect((await restricted.query("select * from messages")).rows).toHaveLength(0);
      await expect(restricted.query("select * from admin_sessions")).rejects.toThrow(/permission denied/);
      await expect(restricted.query("set role postgres")).rejects.toThrow(/permission denied/);
    } finally {
      await restricted.end();
    }
  });

  it("the runtime role cannot call owner-only functions or read secrets", async () => {
    await expect(rows({}, "select private.upsert_admin('e@x.io', 'password123', 'x', 'admin')")).rejects.toThrow(
      /permission denied/,
    );
    const adminRows = await rows<Record<string, unknown>>({ adminToken: admin }, "select * from admin_profiles");
    expect(adminRows.length).toBeGreaterThan(0);
    await expect(rows({ adminToken: admin }, "select * from admin_sessions")).rejects.toThrow(/permission denied/);
  });

  it("visitors cannot call admin functions", async () => {
    const reply = await attempt({ visitorToken: tokenA }, "select public.admin_send_reply($1, 'forged', $2)", [
      sessionA,
      randomUUID(),
    ]);
    expect(reply.error?.message).toBe("TP:forbidden");
    expect((await attempt({ visitorToken: tokenA }, "select public.admin_stats('UTC')")).error?.message).toBe(
      "TP:forbidden",
    );
  });

  it("admins can read everything and reply; visitors never see who replied", async () => {
    const id = { adminToken: admin };
    const [session] = await rows<Record<string, unknown>>(id, "select * from admin_session_list where id = $1", [
      sessionA,
    ]);
    expect(session.user_key_hint).toBe(keyA.slice(-4));
    expect(session.unanswered_count).toBe(1);

    const reply = await attempt(id, "select public.admin_send_reply($1, 'Hello from the operator', $2)", [
      sessionA,
      randomUUID(),
    ]);
    expect(reply.error).toBeNull();

    const [after] = await rows(id, "select unanswered_count, message_count from sessions where id = $1", [sessionA]);
    expect(after).toEqual({ unanswered_count: 0, message_count: 2 });

    const msgs = await rows<Record<string, unknown>>(
      { visitorToken: tokenA },
      "select * from messages where session_id = $1 order by created_at",
      [sessionA],
    );
    expect(msgs.at(-1)?.sender_type).toBe("admin");
    expect(await rows({ visitorToken: tokenA }, "select * from admin_reply_log")).toHaveLength(0);
  });
});

describe("admin authentication", () => {
  it("rejects wrong passwords and locks after five failures", async () => {
    const email = "locked@test.local";
    await owner.query("select private.upsert_admin($1, 'Correct#Horse1', 'Lock', 'admin')", [email]);
    const login = (pw: string) =>
      attempt<Record<string, unknown>>({}, "select public.admin_login($1, $2, $3)", [email, pw, newToken()]);

    for (let i = 0; i < 5; i++) expect((await login("wrong-password")).data).toEqual({ error: "invalid_credentials" });
    const locked = await login("Correct#Horse1");
    expect(locked.error?.message).toBe("TP:account_locked");
  });

  it("does not reveal whether an email exists", async () => {
    const res = await attempt({}, "select public.admin_login($1, $2, $3)", ["nobody@test.local", "whatever1234", newToken()]);
    expect(res.error?.message).toBe("TP:invalid_credentials");
  });

  it("admin sessions end on logout and expire", async () => {
    const token = await adminToken();
    expect(await rows({ adminToken: token }, "select id from users limit 1")).not.toBeNull();
    expect((await attempt({ adminToken: token }, "select public.admin_me()")).data).toMatchObject({ email: ADMIN_EMAIL });
    await attempt({ adminToken: token }, "select public.admin_logout()");
    expect((await attempt({ adminToken: token }, "select public.admin_me()")).data).toBeNull();

    const expiring = await adminToken();
    await owner.query("update admin_sessions set expires_at = now() - interval '1 second'");
    expect((await attempt({ adminToken: expiring }, "select public.admin_stats('UTC')")).error?.message).toBe(
      "TP:forbidden",
    );
    admin = await adminToken();
  });

  it("stores bcrypt hashes, never plaintext", async () => {
    const { rows: r } = await owner.query("select password_hash from admin_profiles where email = $1", [ADMIN_EMAIL]);
    expect(r[0].password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(r[0].password_hash).not.toContain(ADMIN_PASSWORD);
  });
});

describe("message rules", () => {
  it("is idempotent for a repeated client message id", async () => {
    const token = newToken();
    const { session } = await register(token, "Idem");
    const key = randomUUID();
    const first = await send(token, session.id, "once only", key);
    const second = await send(token, session.id, "once only", key);
    expect(second.data?.id).toBe(first.data?.id);
    expect(second.data?.duplicate).toBe(true);
    const { rows: c } = await owner.query("select count(*)::int as n from messages where session_id = $1", [session.id]);
    expect(c[0].n).toBe(1);
  });

  it("rejects an identical message re-sent within seconds", async () => {
    const token = newToken();
    const { session } = await register(token, "Dup");
    expect((await send(token, session.id, "same text")).error).toBeNull();
    expect((await send(token, session.id, "same text")).error?.message).toBe("TP:duplicate_message");
  });

  it("rejects empty and over-length messages and strips control characters", async () => {
    const token = newToken();
    const { session } = await register(token, "Len");
    expect((await send(token, session.id, "   \n  ")).error?.message).toBe("TP:empty_message");
    const tooLong = await send(token, session.id, "x".repeat(2001));
    expect(tooLong.error?.message).toBe("TP:message_too_long");
    expect(tooLong.error?.detail).toBe("2000");
    expect((await send(token, session.id, "a\u0007b\r\nc")).data?.content).toBe("ab\nc");
  });

  it("stores markup verbatim (the UI renders it as text, never HTML)", async () => {
    const token = newToken();
    const { session } = await register(token, "Xss");
    const payload = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
    expect((await send(token, session.id, payload)).data?.content).toBe(payload);
  });

  it("enforces the per-user rate limit (10/min by default)", async () => {
    const token = newToken();
    const { session } = await register(token, "Rate");
    for (let i = 0; i < 10; i++) expect((await send(token, session.id, `message ${i}`)).error).toBeNull();
    const limited = await send(token, session.id, "one too many");
    expect(limited.error?.message).toBe("TP:rate_limited");
    expect(Number(limited.error?.detail)).toBeGreaterThan(0);
  });

  it("rate limit is per user across sessions and browsers", async () => {
    const t1 = newToken();
    const t2 = newToken();
    const first = await register(t1, "R");
    const s1 = first.session.id;
    const s2 = (await register(t2, "R", first.key)).session.id;
    for (let i = 0; i < 10; i++) expect((await send(i % 2 ? t1 : t2, i % 2 ? s1 : s2, `m${i}`)).error).toBeNull();
    expect((await send(t1, s1, "over")).error?.message).toBe("TP:rate_limited");
  });

  it("blocks sending, new sessions and signing in for blocked users", async () => {
    const token = newToken();
    const { session, userId, key } = await register(token, "Blocked");
    await rows({ adminToken: admin }, "update users set status = 'blocked' where id = $1", [userId]);

    expect((await send(token, session.id, "hello?")).error?.message).toBe("TP:user_blocked");
    expect((await attempt({ visitorToken: token }, "select public.visitor_create_session()")).error?.message).toBe(
      "TP:user_blocked",
    );
    expect((await login(newToken(), key)).error?.message).toBe("TP:user_blocked");
  });

  it("rejects messages to closed sessions and logs a system notice", async () => {
    const token = newToken();
    const { session } = await register(token, "Closed");
    const closed = await attempt<Record<string, unknown>>(
      { adminToken: admin },
      "select public.admin_set_session_status($1, 'closed')",
      [session.id],
    );
    expect(closed.data?.status).toBe("closed");
    expect((await send(token, session.id, "anyone?")).error?.message).toBe("TP:session_closed");
    expect(await rows({ visitorToken: token }, "select sender_type from messages")).toEqual([{ sender_type: "system" }]);
  });

  it("supports multiple independent sessions per visitor", async () => {
    const token = newToken();
    const { session } = await register(token, "Multi");
    const second = await attempt<{ id: string }>({ visitorToken: token }, "select public.visitor_create_session()");
    expect(second.data?.id).not.toBe(session.id);
    expect(await rows({ visitorToken: token }, "select id from sessions")).toHaveLength(2);
  });

  it("visitors can delete their own sessions; operators keep the record", async () => {
    const token = newToken();
    const stranger = newToken();
    await register(stranger, "Stranger");
    const { session } = await register(token, "Deleter");
    await send(token, session.id, "please forget this");

    const q = "select public.visitor_delete_session($1)";
    expect((await attempt({ visitorToken: stranger }, q, [session.id])).error?.message).toBe("TP:session_not_found");
    expect((await attempt({ visitorToken: token }, q, [session.id])).error).toBeNull();

    // Gone for the visitor (list, messages, sending, repeat delete)…
    expect(await rows({ visitorToken: token }, "select id from sessions")).toHaveLength(0);
    expect(await rows({ visitorToken: token }, "select id from messages")).toHaveLength(0);
    expect((await send(token, session.id, "again?")).error).not.toBeNull();
    expect((await attempt({ visitorToken: token }, q, [session.id])).error?.message).toBe("TP:session_not_found");

    // …but kept, closed and flagged for operators.
    const [row] = await rows<Record<string, unknown>>(
      { adminToken: admin },
      "select status, visitor_hidden_at, message_count from admin_session_list where id = $1",
      [session.id],
    );
    expect(row.status).toBe("closed");
    expect(row.visitor_hidden_at).not.toBeNull();
    expect(row.message_count).toBe(2); // visitor message + system notice
  });

  it("limits how many sessions a browser can open per hour", async () => {
    const token = newToken();
    await register(token, "Spam");
    for (let i = 0; i < 19; i++) {
      expect((await attempt({ visitorToken: token }, "select public.visitor_create_session()")).error).toBeNull();
    }
    const limited = await attempt({ visitorToken: token }, "select public.visitor_create_session()");
    expect(limited.error?.message).toBe("TP:session_rate_limited");
  });

  it("lets visitors acknowledge operator replies only in their own sessions", async () => {
    const token = newToken();
    const stranger = newToken();
    await register(stranger, "Stranger");
    const { session } = await register(token, "Ack");
    await send(token, session.id, "ping");
    await attempt({ adminToken: admin }, "select public.admin_send_reply($1, 'pong', $2)", [session.id, randomUUID()]);

    const q = "select public.visitor_ack($1, 'read')";
    expect((await attempt({ visitorToken: stranger }, q, [session.id])).error?.message).toBe("TP:session_not_found");
    expect((await attempt({ visitorToken: token }, q, [session.id])).data).toBe(1);
  });

  it("deleting a user cascades to sessions, messages and access links", async () => {
    const token = newToken();
    const { session, userId } = await register(token, "Gone");
    await send(token, session.id, "bye");
    const deleted = await rows({ adminToken: admin }, "delete from users where id = $1 returning id", [userId]);
    expect(deleted).toHaveLength(1);
    const { rows: left } = await owner.query(
      "select (select count(*) from sessions where id = $1)::int + (select count(*) from messages where session_id = $1)::int as n",
      [session.id],
    );
    expect(left[0].n).toBe(0);
    expect(await rows({ visitorToken: token }, "select public.visitor_me() as me")).toEqual([{ me: null }]);
  });
});

describe("admin statistics & config", () => {
  it("are computed from real records", async () => {
    const stats = await attempt<Record<string, unknown>>({ adminToken: admin }, "select public.admin_stats('Europe/London')");
    const { rows: c } = await owner.query("select count(*)::int as n from users");
    expect(stats.data?.total_users).toBe(c[0].n);
    expect(Array.isArray(stats.data?.recent_activity)).toBe(true);
  });

  it("public config is readable without credentials; only admins can change it", async () => {
    expect((await attempt({}, "select public.get_public_config()")).data).toEqual({
      message_max_length: 2000,
      rate_limit_per_minute: 10,
    });
    expect(await rows({ visitorToken: newToken() }, "update app_config set rate_limit_per_minute = 99 returning 1")).toHaveLength(0);
    expect(
      await rows({ adminToken: admin }, "update app_config set rate_limit_per_minute = 12 returning rate_limit_per_minute"),
    ).toEqual([{ rate_limit_per_minute: 12 }]);
    await rows({ adminToken: admin }, "update app_config set rate_limit_per_minute = 10");
  });
});

// Keep the unused-import linter honest about the password constant used by helpers.
void ADMIN_PASSWORD;
