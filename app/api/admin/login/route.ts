import type { NextRequest } from "next/server";
import { z } from "zod";
import { ADMIN_TTL_HOURS, generateToken, setAdminCookie } from "@/lib/auth/tokens";
import { callJson, withDb } from "@/lib/db/pool";
import { dbErrorResponse, guardRequest, jsonError, jsonOk, parseBody } from "@/lib/http";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254),
  password: z.string().min(1).max(200),
});

/**
 * Password check happens inside PostgreSQL (bcrypt via pgcrypto) with
 * per-account lockout; this route adds a per-IP limit and sets the cookie.
 */
export async function POST(request: NextRequest) {
  const guard = guardRequest(request, { limitKey: "admin-login", limit: 10, windowMs: 5 * 60_000 });
  if (!guard.ok) return guard.response;

  const body = await parseBody(request, loginSchema);
  if (!body.ok) return jsonError("invalid_credentials");

  const token = generateToken();
  try {
    const result = await withDb({}, (c) =>
      callJson<{ error?: string; id?: string; display_name?: string; role?: string }>(
        c,
        "select public.admin_login($1, $2, $3, $4)",
        [body.data.email, body.data.password, token, ADMIN_TTL_HOURS],
      ),
    );
    if (!result || result.error) return jsonError("invalid_credentials");
    await setAdminCookie(token);
    return jsonOk({ display_name: result.display_name, role: result.role });
  } catch (error) {
    return dbErrorResponse(error, "admin login");
  }
}
