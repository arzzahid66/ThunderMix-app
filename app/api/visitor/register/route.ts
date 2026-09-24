import type { NextRequest } from "next/server";
import { generateToken, readVisitorToken, setVisitorCookie } from "@/lib/auth/tokens";
import { callJson, withDb } from "@/lib/db/pool";
import { fromDatabaseError } from "@/lib/errors";
import { dbErrorResponse, guardRequest, jsonOk, parseBody } from "@/lib/http";
import { registerSchema } from "@/lib/validation/schemas";
import type { VisitorSession } from "@/types";

interface RegisterResult {
  user: { name: string; is_new: boolean };
  session: VisitorSession;
}

/**
 * Identifies a visitor. The browser's credential is a random token in an
 * httpOnly cookie (created here on first use); the database links its hash to
 * the user record for the normalized email and opens a new session.
 */
export async function POST(request: NextRequest) {
  const guard = guardRequest(request, { limitKey: "register", limit: 10 });
  if (!guard.ok) return guard.response;

  const body = await parseBody(request, registerSchema);
  if (!body.ok) return body.response;
  const { name, email } = body.data;

  const register = (token: string) =>
    withDb({ visitorToken: token }, (c) =>
      callJson<RegisterResult>(c, "select public.visitor_register($1, $2)", [name, email]),
    );

  let token = (await readVisitorToken()) ?? generateToken();
  try {
    let result: RegisterResult;
    try {
      result = await register(token);
    } catch (error) {
      const code = fromDatabaseError(error).code;
      // This browser's token belongs to another email, or was revoked on exit:
      // issue a fresh token so histories never mix.
      if (code !== "identity_mismatch" && code !== "not_authenticated") throw error;
      token = generateToken();
      result = await register(token);
    }
    await setVisitorCookie(token);
    return jsonOk(result, 201);
  } catch (error) {
    return dbErrorResponse(error, "register");
  }
}
