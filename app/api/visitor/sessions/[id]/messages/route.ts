import type { NextRequest } from "next/server";
import { readVisitorToken } from "@/lib/auth/tokens";
import { withDb } from "@/lib/db/pool";
import { dbNow, listSessionMessages } from "@/lib/db/queries";
import { dbErrorResponse, jsonError, jsonOk } from "@/lib/http";
import { uuidSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

/** Full history of one of the caller's own sessions (RLS-scoped). */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/visitor/sessions/[id]/messages">) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return jsonError("session_not_found");

  const token = await readVisitorToken();
  if (!token) return jsonError("no_access");
  try {
    const data = await withDb({ visitorToken: token }, async (c) => {
      const owned = await c.query("select 1 from public.sessions where id = $1", [id]);
      if (!owned.rowCount) return null;
      return { messages: await listSessionMessages(c, id), now: await dbNow(c) };
    });
    return data ? jsonOk(data) : jsonError("session_not_found");
  } catch (error) {
    return dbErrorResponse(error, "visitor messages");
  }
}
