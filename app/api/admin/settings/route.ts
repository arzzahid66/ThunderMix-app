import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { withDb } from "@/lib/db/pool";
import { getAppConfig } from "@/lib/db/queries";
import { dbErrorResponse, jsonOk, parseBody } from "@/lib/http";
import { settingsSchema } from "@/lib/validation/schemas";
import type { AppConfig } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const config = await withDb({ adminToken: auth.admin.token }, getAppConfig);
    return jsonOk({ config, profile: auth.admin.profile });
  } catch (error) {
    return dbErrorResponse(error, "admin settings");
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await parseBody(request, settingsSchema);
  if (!body.ok) return body.response;

  try {
    const config = await withDb({ adminToken: auth.admin.token }, async (c) => {
      const { rows } = await c.query<AppConfig>(
        `update public.app_config
         set message_max_length = $1, rate_limit_per_minute = $2, sessions_per_hour = $3, updated_at = now()
         where id
         returning message_max_length, rate_limit_per_minute, sessions_per_hour, updated_at`,
        [body.data.message_max_length, body.data.rate_limit_per_minute, body.data.sessions_per_hour],
      );
      return rows[0];
    });
    return jsonOk(config);
  } catch (error) {
    return dbErrorResponse(error, "admin settings update");
  }
}
