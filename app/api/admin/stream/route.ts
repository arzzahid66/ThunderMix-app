import type { NextRequest } from "next/server";
import { readAdminToken } from "@/lib/auth/tokens";
import { callJson, withDb } from "@/lib/db/pool";
import { adminChangesSince, dbNow } from "@/lib/db/queries";
import { makeError } from "@/lib/errors";
import { jsonError } from "@/lib/http";
import { pollingStream, toIso, type StreamEvent } from "@/lib/realtime/sse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Live feed of all message, session and user changes for the dashboard. */
export async function GET(request: NextRequest) {
  const token = await readAdminToken();
  if (!token) return jsonError("not_authenticated");

  return pollingStream(request, (since) =>
    withDb({ adminToken: token }, async (c) => {
      const me = await callJson<{ id: string } | null>(c, "select public.admin_me()");
      const now = await dbNow(c);
      if (!me) return { now, events: [], stop: { event: "auth", data: makeError("not_authenticated") } };

      const { messages, sessions, users } = await adminChangesSince(c, since);
      const events: StreamEvent[] = [
        ...users.map((u) => ({ event: "user", key: `u:${u.id}`, version: toIso(u.updated_at), data: u })),
        ...sessions.map((s) => ({ event: "session", key: `s:${s.id}`, version: toIso(s.updated_at), data: s })),
        ...messages.map((m) => ({ event: "message", key: `m:${m.id}`, version: toIso(m.updated_at), data: m })),
      ];
      return { now, events };
    }),
  );
}
