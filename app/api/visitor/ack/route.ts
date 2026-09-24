import type { NextRequest } from "next/server";
import { z } from "zod";
import { readVisitorToken } from "@/lib/auth/tokens";
import { callJson, withDb } from "@/lib/db/pool";
import { dbErrorResponse, guardRequest, jsonError, jsonOk, parseBody } from "@/lib/http";

const ackSchema = z.object({
  sessionId: z.uuid(),
  status: z.enum(["delivered", "read"]),
});

/** Marks operator replies as delivered/read (drives the admin's delivery status). */
export async function POST(request: NextRequest) {
  const guard = guardRequest(request, { limitKey: "ack", limit: 120 });
  if (!guard.ok) return guard.response;

  const body = await parseBody(request, ackSchema);
  if (!body.ok) return body.response;

  const token = await readVisitorToken();
  if (!token) return jsonError("no_access");
  try {
    const updated = await withDb({ visitorToken: token }, (c) =>
      callJson<number>(c, "select public.visitor_ack($1, $2::public.delivery_status)", [
        body.data.sessionId,
        body.data.status,
      ]),
    );
    return jsonOk({ updated });
  } catch (error) {
    return dbErrorResponse(error, "ack");
  }
}
