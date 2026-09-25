import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { generatePrivateKey } from "@/lib/auth/tokens";
import { withDb } from "@/lib/db/pool";
import { getAdminUser, listAdminUsers } from "@/lib/db/queries";
import { dbErrorResponse, jsonError, jsonOk, parseBody } from "@/lib/http";
import { createUserSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["active", "blocked"]).optional(),
  sort: z.enum(["activity", "newest", "name"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const raw = Object.fromEntries([...request.nextUrl.searchParams].filter(([, v]) => v !== ""));
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) return jsonError("invalid_request");

  try {
    const page = await withDb({ adminToken: auth.admin.token }, (c) => listAdminUsers(c, parsed.data));
    return jsonOk(page);
  } catch (error) {
    return dbErrorResponse(error, "admin users");
  }
}

/**
 * Creates a user with a freshly generated private key. The key is returned
 * here exactly once; the database keeps only its hash.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await parseBody(request, createUserSchema);
  if (!body.ok) return body.response;

  const key = generatePrivateKey();
  try {
    const user = await withDb({ adminToken: auth.admin.token }, async (c) => {
      const { rows } = await c.query<{ id: string }>("select public.admin_create_user($1, $2) as id", [
        body.data.name,
        key,
      ]);
      return getAdminUser(c, rows[0].id);
    });
    return jsonOk({ user, key }, 201);
  } catch (error) {
    return dbErrorResponse(error, "admin user create");
  }
}
