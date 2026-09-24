import type { NextRequest } from "next/server";
import { readVisitorToken } from "@/lib/auth/tokens";
import { callJson, withDb } from "@/lib/db/pool";
import { dbNow, listVisitorSessions } from "@/lib/db/queries";
import { dbErrorResponse, guardRequest, jsonError, jsonOk } from "@/lib/http";
import type { PublicConfig, VisitorProfile, VisitorSession } from "@/types";

export const dynamic = "force-dynamic";

/** Bootstrap for the terminal: profile, own sessions, limits and a stream cursor. */
export async function GET() {
  const token = await readVisitorToken();
  if (!token) return jsonError("no_access");
  try {
    const data = await withDb({ visitorToken: token }, async (c) => {
      const profile = await callJson<VisitorProfile | null>(c, "select public.visitor_me()");
      if (!profile) return null;
      return {
        profile,
        sessions: await listVisitorSessions(c),
        config: await callJson<PublicConfig>(c, "select public.get_public_config()"),
        now: await dbNow(c),
      };
    });
    return data ? jsonOk(data) : jsonError("no_access");
  } catch (error) {
    return dbErrorResponse(error, "visitor sessions");
  }
}

/** Opens a new terminal session for the current browser identity. */
export async function POST(request: NextRequest) {
  const guard = guardRequest(request, { limitKey: "new-session", limit: 20 });
  if (!guard.ok) return guard.response;

  const token = await readVisitorToken();
  if (!token) return jsonError("no_access");
  try {
    const session = await withDb({ visitorToken: token }, (c) =>
      callJson<VisitorSession>(c, "select public.visitor_create_session()"),
    );
    return jsonOk(session, 201);
  } catch (error) {
    return dbErrorResponse(error, "new session");
  }
}
