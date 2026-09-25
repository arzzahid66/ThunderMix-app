import type { NextRequest } from "next/server";
import { generateToken, readVisitorToken, setVisitorCookie } from "@/lib/auth/tokens";
import { callJson, withDb } from "@/lib/db/pool";
import { fromDatabaseError } from "@/lib/errors";
import { dbErrorResponse, guardRequest, jsonOk, parseBody } from "@/lib/http";
import { loginSchema } from "@/lib/validation/schemas";
import type { VisitorSession } from "@/types";

interface LoginResult {
  user: { name: string };
  session: VisitorSession;
}

/**
 * Signs a visitor in with the private key an administrator issued. The
 * browser's credential is a random token in an httpOnly cookie (created here
 * on first use); the database links its hash to the key's user and opens a new
 * session. Tightly rate limited, as this is the key-guessing surface.
 */
export async function POST(request: NextRequest) {
  const guard = guardRequest(request, { limitKey: "login", limit: 10 });
  if (!guard.ok) return guard.response;

  const body = await parseBody(request, loginSchema);
  if (!body.ok) return body.response;
  const { key } = body.data;

  const login = (token: string) =>
    withDb({ visitorToken: token }, (c) => callJson<LoginResult>(c, "select public.visitor_login($1)", [key]));

  let token = (await readVisitorToken()) ?? generateToken();
  try {
    let result: LoginResult;
    try {
      result = await login(token);
    } catch (error) {
      const code = fromDatabaseError(error).code;
      // This browser's token belongs to another user, or was revoked on exit
      // or key regeneration: issue a fresh token so histories never mix.
      if (code !== "identity_mismatch" && code !== "not_authenticated") throw error;
      token = generateToken();
      result = await login(token);
    }
    await setVisitorCookie(token);
    return jsonOk(result, 201);
  } catch (error) {
    return dbErrorResponse(error, "login");
  }
}
