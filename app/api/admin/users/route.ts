import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { withDb } from "@/lib/db/pool";
import { listAdminUsers } from "@/lib/db/queries";
import { dbErrorResponse, jsonError, jsonOk } from "@/lib/http";

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
