import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { callJson, withDb } from "@/lib/db/pool";
import { dbErrorResponse, jsonError, jsonOk, parseBody } from "@/lib/http";
import { adminReplySchema, uuidSchema } from "@/lib/validation/schemas";
import type { Message } from "@/types";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/admin/sessions/[id]/reply">) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError("session_not_found");
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await parseBody(request, adminReplySchema);
  if (!body.ok) return body.response;

  try {
    const message = await withDb({ adminToken: auth.admin.token }, (c) =>
      callJson<Message>(c, "select public.admin_send_reply($1, $2, $3)", [
        id,
        body.data.content,
        body.data.clientMsgId,
      ]),
    );
    return jsonOk(message, 201);
  } catch (error) {
    return dbErrorResponse(error, "admin reply");
  }
}
