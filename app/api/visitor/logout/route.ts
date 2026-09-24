import type { NextRequest } from "next/server";
import { clearCookie, COOKIE, readVisitorToken } from "@/lib/auth/tokens";
import { withDb } from "@/lib/db/pool";
import { guardRequest, jsonOk } from "@/lib/http";

/**
 * Ends this browser's visitor identity: the token is revoked in the database
 * and the cookie cleared. History stays stored for operators, but this browser
 * can no longer open it.
 */
export async function POST(request: NextRequest) {
  const guard = guardRequest(request);
  if (!guard.ok) return guard.response;

  const token = await readVisitorToken();
  if (token) {
    await withDb({ visitorToken: token }, (c) => c.query("select public.visitor_logout()")).catch((error) =>
      console.error("[visitor logout]", error),
    );
  }
  await clearCookie(COOKIE.visitor);
  return jsonOk({ signedOut: true });
}
