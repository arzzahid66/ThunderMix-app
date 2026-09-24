import type { NextRequest } from "next/server";
import { readVisitorToken } from "@/lib/auth/tokens";
import { callJson, withDb } from "@/lib/db/pool";
import { dbErrorResponse, guardRequest, jsonError, jsonOk, parseBody } from "@/lib/http";
import { sendMessageSchema } from "@/lib/validation/schemas";
import type { Message } from "@/types";

/**
 * Stores a visitor message. Ownership, blocked status, the configured length
 * limit, the per-user rate limit and duplicate detection are enforced inside
 * the database function; this layer adds input parsing and a coarse IP limit.
 */
export async function POST(request: NextRequest) {
  const guard = guardRequest(request, { limitKey: "message", limit: 40 });
  if (!guard.ok) return guard.response;

  const body = await parseBody(request, sendMessageSchema);
  if (!body.ok) return body.response;

  const token = await readVisitorToken();
  if (!token) return jsonError("no_access");
  try {
    const message = await withDb({ visitorToken: token }, (c) =>
      callJson<Message & { duplicate?: boolean }>(c, "select public.visitor_send_message($1, $2, $3)", [
        body.data.sessionId,
        body.data.content,
        body.data.clientMsgId,
      ]),
    );
    return jsonOk(message, 201);
  } catch (error) {
    return dbErrorResponse(error, "send message");
  }
}
