import { makeError, type ApiError } from "@/lib/errors";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError; status: number };

/** Small fetch wrapper for the app's own JSON route handlers. */
export async function apiRequest<T>(
  url: string,
  options: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal } = {},
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    const method = options.method ?? (options.body === undefined ? "GET" : "POST");
    res = await fetch(url, {
      method,
      headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(options.body ?? {}),
      cache: "no-store",
      credentials: "same-origin",
      signal: options.signal,
    });
  } catch {
    return { ok: false, error: makeError("network_error"), status: 0 };
  }

  let payload: { data?: T; error?: ApiError } | null = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (res.ok && payload && "data" in payload) {
    return { ok: true, data: payload.data as T };
  }
  return {
    ok: false,
    error: payload?.error ?? makeError(res.status >= 500 ? "server_error" : "invalid_request"),
    status: res.status,
  };
}

export function newClientId(): string {
  return crypto.randomUUID();
}
