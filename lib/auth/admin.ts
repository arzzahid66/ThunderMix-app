import type { NextRequest, NextResponse } from "next/server";
import { callJson, withDb } from "@/lib/db/pool";
import { guardRequest, jsonError } from "@/lib/http";
import type { AdminProfile } from "@/types";
import { readAdminToken } from "./tokens";

export interface AdminSession {
  token: string;
  profile: AdminProfile & { email: string };
}

/**
 * Resolves the signed-in administrator. The database hashes the cookie token
 * and checks it against unexpired admin_sessions rows.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const token = await readAdminToken();
  if (!token) return null;
  const profile = await withDb({ adminToken: token }, (c) =>
    callJson<(AdminProfile & { email: string }) | null>(c, "select public.admin_me()"),
  );
  return profile ? { token, profile } : null;
}

type AdminGuard = { ok: true; admin: AdminSession } | { ok: false; response: NextResponse };

/** Same-origin (for mutations) + authenticated administrator, for route handlers. */
export async function requireAdmin(request: NextRequest): Promise<AdminGuard> {
  if (request.method !== "GET") {
    const guard = guardRequest(request);
    if (!guard.ok) return guard;
  }
  try {
    const admin = await getAdminSession();
    if (!admin) return { ok: false, response: jsonError("not_authenticated") };
    return { ok: true, admin };
  } catch (error) {
    console.error("[admin] session check failed", error);
    return { ok: false, response: jsonError("server_error") };
  }
}
