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
  register,
  resetDatabase,
  rows,
  send,
  TEST_URL,
  uniqueEmail,
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

describe("registration & identity", () => {
  it("creates a user, normalizes the email and opens a session", async () => {
    const email = uniqueEmail("norm");
    const result = await register(newToken(), "  Ada   Lovelace ", `  ${email.toUpperCase()} `);

    expect(result.user).toEqual({ name: "Ada Lovelace", is_new: true });
    expect(result.session.session_code).toMatch(/^SESS_[A-Z0-9]{6}$/);
    const { rows: users } = await owner.query("select email, name from users where email = $1", [email]);
    expect(users).toEqual([{ email, name: "Ada Lovelace" }]);
  });

  it("reuses the existing user for the same email and never duplicates it", async () => {
    const email = uniqueEmail("dup");
    await register(newToken(), "First", email);
    const second = await register(newToken(), "Impostor Name", ` ${email.toUpperCase()}`);

    expect(second.user).toEqual({ name: "First", is_new: false }); // unverified visitors cannot rename a user
    const { rows: count } = await owner.query("select count(*)::int as n from users where email = $1", [email]);
    expect(count[0].n).toBe(1);
  });

  it("stores only a hash of the browser token", async () => {
    const token = newToken();
    await register(token, "Hash", uniqueEmail("hash"));
    const { rows: found } = await owner.query("select token_hash from visitor_access where token_hash = $1", [token]);
    expect(found).toHaveLength(0);
    const { rows: hashed } = await owner.query(
      "select 1 from visitor_access where token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')",
      [token],
    );
    expect(hashed).toHaveLength(1);
  });

  it("rejects invalid names, emails and missing/short tokens", async () => {
    const t = { visitorToken: newToken() };
    const q = "select public.visitor_register($1, $2)";
    expect((await attempt(t, q, ["Ok", "not-an-email"])).error?.message).toBe("TP:invalid_email");
    expect((await attempt(t, q, ["   ", uniqueEmail()])).error?.message).toBe("TP:invalid_name");
    expect((await attempt(t, q, ["x".repeat(61), uniqueEmail()])).error?.message).toBe("TP:invalid_name");
    expect((await attempt({}, q, ["X", uniqueEmail()])).error?.message).toBe("TP:not_authenticated");
    expect((await attempt({ visitorToken: "short" }, q, ["X", uniqueEmail()])).error?.message).toBe(
      "TP:not_authenticated",
    );
  });

  it("refuses to link one browser token to a second email", async () => {
    const token = newToken();
    await register(token, "One", uniqueEmail("one"));
    const res = await attempt({ visitorToken: token }, "select public.visitor_register($1, $2)", ["Two", uniqueEmail()]);
    expect(res.error?.message).toBe("TP:identity_mismatch");
  });

  it("revoked tokens (exit) lose access", async () => {
    const token = newToken();
    const { session } = await register(token, "Exit", uniqueEmail("exit"));
    await attempt({ visitorToken: token }, "select public.visitor_logout()");
    expect(await rows({ visitorToken: token }, "select id from sessions")).toHaveLength(0);
    expect((await send(token, session.id, "hi")).error?.message).toBe("TP:no_access");
  });
});

describe("row level security", () => {
  const tokenA = newToken();
  const tokenB = newToken();
  let sessionA: string;
  const sharedEmail = uniqueEmail("shared");

  beforeAll(async () => {
    sessionA = (await register(tokenA, "Alice", sharedEmail)).session.id;
    expect((await send(tokenA, sessionA, "private message from A")).error).toBeNull();
    // Visitor B claims the SAME email from another browser.
    await register(tokenB, "Mallory", sharedEmail);
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

  it("the same email in another browser does NOT reveal the first browser's history", async () => {
    const sessions = await rows<{ id: string }>({ visitorToken: tokenB }, "select id from sessions");
    expect(sessions.map((s) => s.id)).not.toContain(sessionA);
    expect(await rows({ visitorToken: tokenB }, "select * from messages where session_id = $1", [sessionA])).toHaveLength(0);
    expect(await rows({ visitorToken: tokenB }, "select * from users")).toHaveLength(0);
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
    expect(session.user_email).toBe(sharedEmail);
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
    const { session } = await register(token, "Idem", uniqueEmail("idem"));
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
    const { session } = await register(token, "Dup", uniqueEmail("dupmsg"));
    expect((await send(token, session.id, "same text")).error).toBeNull();
    expect((await send(token, session.id, "same text")).error?.message).toBe("TP:duplicate_message");
  });

  it("rejects empty and over-length messages and strips control characters", async () => {
    const token = newToken();
    const { session } = await register(token, "Len", uniqueEmail("len"));
    expect((await send(token, session.id, "   \n  ")).error?.message).toBe("TP:empty_message");
    const tooLong = await send(token, session.id, "x".repeat(2001));
    expect(tooLong.error?.message).toBe("TP:message_too_long");
    expect(tooLong.error?.detail).toBe("2000");
    expect((await send(token, session.id, "a\u0007b\r\nc")).data?.content).toBe("ab\nc");
  });

  it("stores markup verbatim (the UI renders it as text, never HTML)", async () => {
    const token = newToken();
    const { session } = await register(token, "Xss", uniqueEmail("xss"));
    const payload = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
    expect((await send(token, session.id, payload)).data?.content).toBe(payload);
  });

  it("enforces the per-user rate limit (10/min by default)", async () => {
    const token = newToken();
    const { session } = await register(token, "Rate", uniqueEmail("rate"));
    for (let i = 0; i < 10; i++) expect((await send(token, session.id, `message ${i}`)).error).toBeNull();
    const limited = await send(token, session.id, "one too many");
    expect(limited.error?.message).toBe("TP:rate_limited");
    expect(Number(limited.error?.detail)).toBeGreaterThan(0);
  });

  it("rate limit is per user across sessions and browsers", async () => {
    const email = uniqueEmail("rate2");
    const t1 = newToken();
    const t2 = newToken();
    const s1 = (await register(t1, "R", email)).session.id;
    const s2 = (await register(t2, "R", email)).session.id;
    for (let i = 0; i < 10; i++) expect((await send(i % 2 ? t1 : t2, i % 2 ? s1 : s2, `m${i}`)).error).toBeNull();
    expect((await send(t1, s1, "over")).error?.message).toBe("TP:rate_limited");
  });

  it("blocks sending, new sessions and re-registration for blocked users", async () => {
    const token = newToken();
    const email = uniqueEmail("blocked");
    const { session } = await register(token, "Blocked", email);
    await rows({ adminToken: admin }, "update users set status = 'blocked' where email = $1", [email]);

    expect((await send(token, session.id, "hello?")).error?.message).toBe("TP:user_blocked");
    expect((await attempt({ visitorToken: token }, "select public.visitor_create_session()")).error?.message).toBe(
      "TP:user_blocked",
    );
    const other = await attempt({ visitorToken: newToken() }, "select public.visitor_register('B', $1)", [email]);
    expect(other.error?.message).toBe("TP:user_blocked");
  });

  it("rejects messages to closed sessions and logs a system notice", async () => {
    const token = newToken();
    const { session } = await register(token, "Closed", uniqueEmail("closed"));
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
    const { session } = await register(token, "Multi", uniqueEmail("multi"));
    const second = await attempt<{ id: string }>({ visitorToken: token }, "select public.visitor_create_session()");
    expect(second.data?.id).not.toBe(session.id);
    expect(await rows({ visitorToken: token }, "select id from sessions")).toHaveLength(2);
  });

  it("visitors can delete their own sessions; operators keep the record", async () => {
    const token = newToken();
    const stranger = newToken();
    await register(stranger, "Stranger", uniqueEmail("delsess-stranger"));
    const { session } = await register(token, "Deleter", uniqueEmail("delsess"));
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
    await register(token, "Spam", uniqueEmail("spam"));
    for (let i = 0; i < 19; i++) {
      expect((await attempt({ visitorToken: token }, "select public.visitor_create_session()")).error).toBeNull();
    }
    const limited = await attempt({ visitorToken: token }, "select public.visitor_create_session()");
    expect(limited.error?.message).toBe("TP:session_rate_limited");
  });

  it("lets visitors acknowledge operator replies only in their own sessions", async () => {
    const token = newToken();
    const stranger = newToken();
    await register(stranger, "Stranger", uniqueEmail("stranger"));
    const { session } = await register(token, "Ack", uniqueEmail("ack"));
    await send(token, session.id, "ping");
    await attempt({ adminToken: admin }, "select public.admin_send_reply($1, 'pong', $2)", [session.id, randomUUID()]);

    const q = "select public.visitor_ack($1, 'read')";
    expect((await attempt({ visitorToken: stranger }, q, [session.id])).error?.message).toBe("TP:session_not_found");
    expect((await attempt({ visitorToken: token }, q, [session.id])).data).toBe(1);
  });

  it("deleting a user cascades to sessions, messages and access links", async () => {
    const token = newToken();
    const email = uniqueEmail("delete");
    const { session } = await register(token, "Gone", email);
    await send(token, session.id, "bye");
    const deleted = await rows({ adminToken: admin }, "delete from users where email = $1 returning id", [email]);
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
