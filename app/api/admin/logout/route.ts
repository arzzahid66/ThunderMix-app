import type { NextRequest } from "next/server";
import { clearCookie, COOKIE, readAdminToken } from "@/lib/auth/tokens";
import { withDb } from "@/lib/db/pool";
import { guardRequest, jsonOk } from "@/lib/http";

export async function POST(request: NextRequest) {
  const guard = guardRequest(request);
  if (!guard.ok) return guard.response;

  const token = await readAdminToken();
  if (token) {
    await withDb({ adminToken: token }, (c) => c.query("select public.admin_logout()")).catch((error) =>
      console.error("[admin logout]", error),
    );
  }
  await clearCookie(COOKIE.admin);
  return jsonOk({ signedOut: true });
}
