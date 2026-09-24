import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { callJson, withDb } from "@/lib/db/pool";
import { dbErrorResponse, jsonOk } from "@/lib/http";
import type { AdminStats } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const tz = (request.nextUrl.searchParams.get("tz") ?? "UTC").slice(0, 64);
  try {
    const stats = await withDb({ adminToken: auth.admin.token }, (c) =>
      callJson<AdminStats>(c, "select public.admin_stats($1)", [tz]),
    );
    return jsonOk(stats);
  } catch (error) {
    return dbErrorResponse(error, "admin stats");
  }
}
