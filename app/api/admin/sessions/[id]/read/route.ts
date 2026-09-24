import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { callJson, withDb } from "@/lib/db/pool";
import { dbErrorResponse, jsonError, jsonOk } from "@/lib/http";
import { uuidSchema } from "@/lib/validation/schemas";

/** Marks the visitor's messages in a session as read by the operator. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/admin/sessions/[id]/read">) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError("session_not_found");
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const updated = await withDb({ adminToken: auth.admin.token }, (c) =>
      callJson<number>(c, "select public.admin_mark_session_read($1)", [id]),
    );
    return jsonOk({ updated });
  } catch (error) {
    return dbErrorResponse(error, "admin mark read");
  }
}
