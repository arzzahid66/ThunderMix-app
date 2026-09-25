import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { ERROR_CATALOG, fromDatabaseError, makeError, type ApiError, type ErrorCode } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit/memory";

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status, headers: { "Cache-Control": "no-store" } });
}

export function jsonError(error: ApiError | ErrorCode) {
  const err = typeof error === "string" ? makeError(error) : error;
  const status = ERROR_CATALOG[err.code].status || 500;
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (err.retryAfter) headers["Retry-After"] = String(err.retryAfter);
  return NextResponse.json({ error: err }, { status, headers });
}

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * CSRF defence for cookie-authenticated mutations: require a JSON body and a
 * same-origin Origin header (auth cookies are also SameSite=Lax).
 */
export function assertSameOrigin(request: NextRequest): ApiError | null {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return makeError("cross_origin");
  try {
    if (new URL(origin).host !== host) return makeError("cross_origin");
  } catch {
    return makeError("cross_origin");
  }
  return null;
}

type Guard = { ok: true } | { ok: false; response: NextResponse };

export function guardRequest(
  request: NextRequest,
  opts: { limitKey?: string; limit?: number; windowMs?: number } = {},
): Guard {
  const originError = assertSameOrigin(request);
  if (originError) return { ok: false, response: jsonError(originError) };

  if (opts.limitKey && opts.limit) {
    const result = checkRateLimit(`${opts.limitKey}:${clientIp(request)}`, opts.limit, opts.windowMs ?? 60_000);
    if (!result.ok) {
      return { ok: false, response: jsonError(makeError("too_many_requests", { retryAfter: result.retryAfter })) };
    }
  }
  return { ok: true };
}

export async function parseBody<T>(
  request: NextRequest,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    return { ok: false, response: jsonError("invalid_request") };
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: jsonError("invalid_request") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = String(first?.path?.[0] ?? "");
    const code: ErrorCode =
      field === "name"
        ? "invalid_name"
        : field === "email"
          ? "invalid_email"
          : field === "key"
            ? "invalid_key"
          : field === "content" && first?.code === "too_small"
            ? "empty_message"
            : field === "content" && first?.code === "too_big"
              ? "message_too_long"
              : "invalid_request";
    return { ok: false, response: jsonError(code) };
  }
  return { ok: true, data: parsed.data };
}

/** Maps a thrown database error to a safe response; logs anything unexpected. */
export function dbErrorResponse(error: unknown, tag: string) {
  const mapped = fromDatabaseError(error);
  if (mapped.code === "server_error") console.error(`[${tag}]`, error);
  return jsonError(mapped);
}
