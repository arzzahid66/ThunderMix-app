import { describe, expect, it } from "vitest";
import { fromDatabaseError, makeError } from "@/lib/errors";
import { formatRelative, sanitizeSearch, toHandle } from "@/lib/format";
import { likePattern } from "@/lib/db/queries";
import { checkRateLimit, resetRateLimits } from "@/lib/rate-limit/memory";
import { buildTimeline, isAwaitingResponse, mergeMessages, mergeSessions, nextAnchor } from "@/lib/terminal/timeline";
import { formatChange, formatXmr, usdToXmr, WALLET_BALANCE_USD } from "@/lib/market/wallet";
import { createUserSchema, loginSchema, privateKeySchema, sendMessageSchema } from "@/lib/validation/schemas";
import type { Message, VisitorSession } from "@/types";

const msg = (id: string, sender: Message["sender_type"], created: string, extra: Partial<Message> = {}): Message => ({
  id,
  session_id: "s1",
  sender_type: sender,
  content: id,
  created_at: created,
  updated_at: created,
  delivery_status: "sent",
  client_msg_id: null,
  ...extra,
});

describe("validation", () => {
  it("accepts a 64-character hex private key in any case", () => {
    const key = "A1b2".repeat(16);
    expect(privateKeySchema.parse(`  ${key} `)).toBe(key.toLowerCase());
    expect(loginSchema.parse({ key }).key).toBe(key.toLowerCase());
  });

  it("rejects malformed private keys", () => {
    expect(privateKeySchema.safeParse("a".repeat(63)).success).toBe(false);
    expect(privateKeySchema.safeParse("a".repeat(65)).success).toBe(false);
    expect(privateKeySchema.safeParse("g".repeat(64)).success).toBe(false);
    expect(privateKeySchema.safeParse(crypto.randomUUID()).success).toBe(false);
    expect(privateKeySchema.safeParse("").success).toBe(false);
  });

  it("normalizes and validates user names", () => {
    expect(createUserSchema.parse({ name: "  Ada \n  Lovelace " })).toEqual({ name: "Ada Lovelace" });
    expect(createUserSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createUserSchema.safeParse({ name: "x".repeat(61) }).success).toBe(false);
    expect(createUserSchema.safeParse({ name: "bad\u0007" }).success).toBe(false);
  });

  it("rejects empty messages and bad ids", () => {
    const base = { sessionId: crypto.randomUUID(), clientMsgId: crypto.randomUUID() };
    expect(sendMessageSchema.safeParse({ ...base, content: "  \r\n " }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ ...base, sessionId: "1; drop table", content: "hi" }).success).toBe(false);
    expect(sendMessageSchema.parse({ ...base, content: " a\r\nb " }).content).toBe("a\nb");
  });
});

describe("wallet", () => {
  it("values the fixed USD balance in XMR", () => {
    expect(WALLET_BALANCE_USD).toBe(3_000_000);
    expect(usdToXmr(3_000_000, 500)).toBe(6000);
    expect(usdToXmr(3_000_000, 553.24)).toBeCloseTo(5422.6014, 4);
    expect(usdToXmr(3_000_000, 0)).toBe(0);
    expect(usdToXmr(3_000_000, Number.NaN)).toBe(0);
  });

  it("formats amounts and the 24h change", () => {
    expect(formatXmr(5422.63762)).toBe("5,422.6376");
    expect(formatChange(-0.1234)).toBe("0.12%");
    expect(formatChange(1.5)).toBe("1.50%");
  });
});

describe("error mapping", () => {
  it("maps TP errors and never leaks unknown errors", () => {
    expect(fromDatabaseError({ message: "TP:rate_limited", detail: "42" })).toMatchObject({ code: "rate_limited", retryAfter: 42 });
    expect(fromDatabaseError({ message: "TP:message_too_long", detail: "2000" })).toMatchObject({ code: "message_too_long", limit: 2000 });
    const leaked = fromDatabaseError({ message: 'relation "users" does not exist', code: "42P01" });
    expect(leaked).toEqual(makeError("server_error"));
    expect(JSON.stringify(leaked)).not.toContain("relation");
    expect(fromDatabaseError(null).code).toBe("server_error");
  });
});

describe("timeline", () => {
  it("merges by id, prefers newer versions and sorts chronologically", () => {
    const a = msg("a", "user", "2026-09-24T10:00:00.000Z");
    const b = msg("b", "admin", "2026-09-24T10:01:00.000Z");
    const merged = mergeMessages([b], [a, b]);
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
    const bRead = { ...b, delivery_status: "read" as const, updated_at: "2026-09-24T10:02:00.000Z" };
    expect(mergeMessages(merged, [bRead])[1].delivery_status).toBe("read");
    // Older version never overwrites a newer one (out-of-order delivery).
    expect(mergeMessages([bRead], [b])[0].delivery_status).toBe("read");
  });

  it("deduplicates repeated realtime events", () => {
    const a = msg("a", "user", "2026-09-24T10:00:00.000Z");
    const once = mergeMessages([], [a]);
    expect(mergeMessages(once, [a, a])).toBe(once);
  });

  it("interleaves local lines after the messages visible when they were added", () => {
    const a = msg("a", "user", "2026-09-24T10:00:00.000Z");
    const anchor = nextAnchor([a], []);
    const later = msg("c", "admin", "2026-09-24T10:05:00.000Z");
    const items = buildTimeline([a, later], [{ id: "l", kind: "help", text: "help", at: anchor }]);
    expect(items.map((i) => i.key)).toEqual(["a", "l", "c"]);
    expect(buildTimeline([a, later], [], anchor).map((i) => i.key)).toEqual(["c"]);
  });

  it("detects when the visitor is awaiting a reply", () => {
    const u = msg("u", "user", "2026-09-24T10:00:00.000Z");
    const ad = msg("ad", "admin", "2026-09-24T10:01:00.000Z");
    const sys = msg("sys", "system", "2026-09-24T10:02:00.000Z");
    expect(isAwaitingResponse([u])).toBe(true);
    expect(isAwaitingResponse([u, ad])).toBe(false);
    expect(isAwaitingResponse([u, sys])).toBe(true);
    expect(isAwaitingResponse([])).toBe(false);
  });

  it("orders sessions by latest activity", () => {
    const s = (id: string, at: string): VisitorSession => ({
      id,
      session_code: id,
      created_at: at,
      last_activity_at: at,
      updated_at: at,
      status: "active",
      message_count: 0,
      unanswered_count: 0,
    });
    const list = mergeSessions([s("old", "2026-01-01T00:00:00Z")], [s("new", "2026-09-01T00:00:00Z")]);
    expect(list.map((x) => x.id)).toEqual(["new", "old"]);
  });
});

describe("format helpers", () => {
  it("derives a safe prompt handle", () => {
    expect(toHandle("Ada Lovelace")).toBe("ada_lovelace");
    expect(toHandle("Zoë <script>")).toBe("zoe_script");
    expect(toHandle("   ")).toBe("visitor");
    expect(toHandle(null)).toBe("visitor");
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-09-24T12:00:00Z");
    expect(formatRelative("2026-09-24T11:59:50Z", now)).toBe("just now");
    expect(formatRelative("2026-09-24T11:30:00Z", now)).toBe("30m ago");
    expect(formatRelative("2026-09-24T09:00:00Z", now)).toBe("3h ago");
  });

  it("escapes LIKE wildcards and strips filter syntax", () => {
    expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
    expect(sanitizeSearch("a,b(c)*")).toBe("a b c");
  });
});

describe("in-memory rate limiter", () => {
  it("allows up to the limit per window then reports retry time", () => {
    resetRateLimits();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(checkRateLimit("k", 3, 60_000, t0 + i).ok).toBe(true);
    const blocked = checkRateLimit("k", 3, 60_000, t0 + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(60);
    expect(checkRateLimit("k", 3, 60_000, t0 + 60_001).ok).toBe(true);
    expect(checkRateLimit("other", 3, 60_000, t0).ok).toBe(true);
  });
});
