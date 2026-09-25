import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { generatePrivateKey } from "@/lib/auth/tokens";
import { withDb } from "@/lib/db/pool";
import { getAdminUser } from "@/lib/db/queries";
import { dbErrorResponse, jsonError, jsonOk } from "@/lib/http";
import { uuidSchema } from "@/lib/validation/schemas";

type Ctx = RouteContext<"/api/admin/users/[id]/key">;

/**
 * Replaces a user's private key and signs out every browser that used the old
 * one. The new key is returned here exactly once.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError("not_found");
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const key = generatePrivateKey();
  try {
    const user = await withDb({ adminToken: auth.admin.token }, async (c) => {
      await c.query("select public.admin_regenerate_key($1, $2)", [id, key]);
      return getAdminUser(c, id);
    });
    return jsonOk({ user, key });
  } catch (error) {
    return dbErrorResponse(error, "admin user key");
  }
}
