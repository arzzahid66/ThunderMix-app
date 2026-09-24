import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { withDb } from "@/lib/db/pool";
import { getAdminUser, listAdminSessions } from "@/lib/db/queries";
import { dbErrorResponse, jsonError, jsonOk, parseBody } from "@/lib/http";
import { deleteUserSchema, userStatusSchema, uuidSchema } from "@/lib/validation/schemas";

type Ctx = RouteContext<"/api/admin/users/[id]">;

export const dynamic = "force-dynamic";

/** User details with all of their sessions. */
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError("not_found");
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const data = await withDb({ adminToken: auth.admin.token }, async (c) => {
      const user = await getAdminUser(c, id);
      if (!user) return null;
      const sessions = await listAdminSessions(c, { userId: id, pageSize: 100 });
      return { user, sessions: sessions.rows };
    });
    return data ? jsonOk(data) : jsonError("not_found");
  } catch (error) {
    return dbErrorResponse(error, "admin user");
  }
}

/** Block or unblock a user. */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError("not_found");
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await parseBody(request, userStatusSchema);
  if (!body.ok) return body.response;

  try {
    const rows = await withDb({ adminToken: auth.admin.token }, async (c) => {
      const res = await c.query(
        "update public.users set status = $2::public.user_status where id = $1 returning id, status",
        [id, body.data.status],
      );
      return res.rows;
    });
    return rows.length ? jsonOk(rows[0]) : jsonError("not_found");
  } catch (error) {
    return dbErrorResponse(error, "admin user status");
  }
}

/**
 * Permanently deletes a user with all sessions, messages and browser access
 * links (ON DELETE CASCADE). Requires the user's email as typed confirmation.
 */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError("not_found");
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await parseBody(request, deleteUserSchema);
  if (!body.ok) return jsonError("confirmation_mismatch");

  try {
    const result = await withDb({ adminToken: auth.admin.token }, async (c) => {
      const user = await c.query<{ email: string }>("select email from public.users where id = $1", [id]);
      if (!user.rowCount) return "not_found" as const;
      if (user.rows[0].email !== body.data.confirmEmail) return "confirmation_mismatch" as const;
      await c.query("delete from public.users where id = $1", [id]);
      return "deleted" as const;
    });
    return result === "deleted" ? jsonOk({ deleted: true }) : jsonError(result);
  } catch (error) {
    return dbErrorResponse(error, "admin user delete");
  }
}
