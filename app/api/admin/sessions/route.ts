import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/admin";
import { withDb } from "@/lib/db/pool";
import { listAdminSessions } from "@/lib/db/queries";
import { dbErrorResponse, jsonError, jsonOk } from "@/lib/http";

export const dynamic = "force-dynamic";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const querySchema = z.object({
  name: z.string().trim().max(100).optional(),
  code: z.string().trim().max(20).optional(),
  status: z.enum(["active", "closed"]).optional(),
  unanswered: z.enum(["1", "true"]).optional(),
  user: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sort: z.enum(["activity", "created", "queue"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/** Server-side filtered, paginated session list. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const raw = Object.fromEntries([...request.nextUrl.searchParams].filter(([, v]) => v !== ""));
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) return jsonError("invalid_request");
  const q = parsed.data;

  try {
    const page = await withDb({ adminToken: auth.admin.token }, (c) =>
      listAdminSessions(c, {
        name: q.name,
        code: q.code,
        status: q.status,
        unanswered: !!q.unanswered,
        userId: q.user,
        from: q.from,
        to: q.to,
        sort: q.sort,
        page: q.page,
        pageSize: q.pageSize,
      }),
    );
    return jsonOk(page);
  } catch (error) {
    return dbErrorResponse(error, "admin sessions");
  }
}
