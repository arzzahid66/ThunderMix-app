import type { NextRequest } from "next/server";
import { readVisitorToken } from "@/lib/auth/tokens";
import { withDb } from "@/lib/db/pool";
import { dbErrorResponse, guardRequest, jsonError, jsonOk } from "@/lib/http";
import { uuidSchema } from "@/lib/validation/schemas";

/**
 * Deletes one of the caller's sessions from their history. The database hides
 * it from this visitor and closes it; operators keep the record.
 */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/visitor/sessions/[id]">) {
  const guard = guardRequest(request, { limitKey: "delete-session", limit: 30 });
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError("session_not_found");

  const token = await readVisitorToken();
  if (!token) return jsonError("no_access");
  try {
    await withDb({ visitorToken: token }, (c) => c.query("select public.visitor_delete_session($1)", [id]));
    return jsonOk({ deleted: true });
  } catch (error) {
    return dbErrorResponse(error, "visitor delete session");
  }
}
