import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { withDb } from "@/lib/db/pool";
import { dbErrorResponse, jsonOk, parseBody } from "@/lib/http";
import { profileSchema } from "@/lib/validation/schemas";

/** Updates the operator's internal display name (never shown to visitors). */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await parseBody(request, profileSchema);
  if (!body.ok) return body.response;

  try {
    const profile = await withDb({ adminToken: auth.admin.token }, async (c) => {
      const { rows } = await c.query(
        "update public.admin_profiles set display_name = $2 where id = $1 returning id, display_name, role",
        [auth.admin.profile.id, body.data.display_name],
      );
      return rows[0];
    });
    return jsonOk(profile);
  } catch (error) {
    return dbErrorResponse(error, "admin profile");
  }
}
