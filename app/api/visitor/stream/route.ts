import type { NextRequest } from "next/server";
import { readVisitorToken } from "@/lib/auth/tokens";
import { callJson, withDb } from "@/lib/db/pool";
import { dbNow, visitorChangesSince } from "@/lib/db/queries";
import { makeError } from "@/lib/errors";
import { jsonError } from "@/lib/http";
import { pollingStream, toIso, type StreamEvent } from "@/lib/realtime/sse";
import type { VisitorProfile } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Live updates for the current browser identity's own sessions and messages. */
export async function GET(request: NextRequest) {
  const token = await readVisitorToken();
  if (!token) return jsonError("no_access");

  return pollingStream(request, (since) =>
    withDb({ visitorToken: token }, async (c) => {
      const profile = await callJson<VisitorProfile | null>(c, "select public.visitor_me()");
      const now = await dbNow(c);
      if (!profile) return { now, events: [], stop: { event: "auth", data: makeError("no_access") } };

      const { messages, sessions } = await visitorChangesSince(c, since);
      const events: StreamEvent[] = [
        { event: "profile", key: "profile", version: profile.status, data: profile },
        ...sessions.map((s) => ({ event: "session", key: `s:${s.id}`, version: toIso(s.updated_at), data: s })),
        ...messages.map((m) => ({ event: "message", key: `m:${m.id}`, version: toIso(m.updated_at), data: m })),
      ];
      return { now, events };
    }),
  );
}
