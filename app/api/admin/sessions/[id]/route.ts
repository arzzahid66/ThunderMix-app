import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { callJson, withDb } from "@/lib/db/pool";
import { dbNow, getAdminSessionRow, listSessionMessages } from "@/lib/db/queries";
import { dbErrorResponse, jsonError, jsonOk, parseBody } from "@/lib/http";
import { sessionStatusSchema, uuidSchema } from "@/lib/validation/schemas";
import type { VisitorSession } from "@/types";

type Ctx = RouteContext<"/api/admin/sessions/[id]">;

export const dynamic = "force-dynamic";

/** Session header + full conversation. */
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError("session_not_found");
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const data = await withDb({ adminToken: auth.admin.token }, async (c) => {
      const session = await getAdminSessionRow(c, id);
      if (!session) return null;
      return { session, messages: await listSessionMessages(c, id, 2000), now: await dbNow(c) };
    });
    return data ? jsonOk(data) : jsonError("session_not_found");
  } catch (error) {
    return dbErrorResponse(error, "admin session");
  }
}

/** Close or reopen a session. */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError("session_not_found");
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await parseBody(request, sessionStatusSchema);
  if (!body.ok) return body.response;

  try {
    const session = await withDb({ adminToken: auth.admin.token }, (c) =>
      callJson<VisitorSession>(c, "select public.admin_set_session_status($1, $2::public.session_status)", [
        id,
        body.data.status,
      ]),
    );
    return jsonOk(session);
  } catch (error) {
    return dbErrorResponse(error, "admin session status");
  }
}

/** Permanently delete a session and its messages. */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError("session_not_found");
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const deleted = await withDb({ adminToken: auth.admin.token }, async (c) => {
      const res = await c.query("delete from public.sessions where id = $1 returning id", [id]);
      return res.rowCount ?? 0;
    });
    return deleted ? jsonOk({ deleted: true }) : jsonError("session_not_found");
  } catch (error) {
    return dbErrorResponse(error, "admin session delete");
  }
}
