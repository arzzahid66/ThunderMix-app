/**
 * Application error codes shared by the API layer and the UI. Database
 * functions raise errors as "TP:<code>"; anything else is treated as an
 * internal error and never shown verbatim to users.
 */
export const ERROR_CATALOG = {
  invalid_request: { status: 400, message: "Malformed request." },
  invalid_name: { status: 400, message: "Name must be between 1 and 60 characters." },
  invalid_email: { status: 400, message: "Enter a valid email address." },
  empty_message: { status: 400, message: "Cannot transmit an empty message." },
  message_too_long: { status: 400, message: "Message exceeds the character limit." },
  invalid_status: { status: 400, message: "Invalid status." },
  not_authenticated: { status: 401, message: "Your access has expired. Please identify yourself again." },
  no_access: { status: 401, message: "This browser has no active identity. Please identify yourself again." },
  invalid_credentials: { status: 401, message: "Invalid email or password." },
  user_blocked: { status: 403, message: "Access to this portal has been restricted." },
  forbidden: { status: 403, message: "You are not authorized to perform this action." },
  cross_origin: { status: 403, message: "Request rejected." },
  session_not_found: { status: 404, message: "Session not found." },
  not_found: { status: 404, message: "Record not found." },
  session_closed: { status: 409, message: "This session is closed. Open a new session to continue." },
  duplicate_message: { status: 409, message: "Duplicate transmission ignored." },
  identity_mismatch: { status: 409, message: "Identity conflict. Please try again." },
  confirmation_mismatch: { status: 409, message: "Confirmation text does not match." },
  rate_limited: { status: 429, message: "Transmission limit reached." },
  session_rate_limited: { status: 429, message: "Too many sessions opened. Try again later." },
  account_locked: { status: 429, message: "Too many failed attempts. The account is temporarily locked." },
  too_many_requests: { status: 429, message: "Too many requests. Slow down and try again shortly." },
  server_error: { status: 500, message: "Something went wrong. Please try again." },
  network_error: { status: 0, message: "Network unreachable. Check your connection." },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export interface ApiError {
  code: ErrorCode;
  message: string;
  /** Seconds until the action may be retried (rate limits, lockouts). */
  retryAfter?: number;
  /** Extra numeric context, e.g. the character limit. */
  limit?: number;
}

export function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CATALOG, value);
}

export function makeError(code: ErrorCode, extra?: Partial<ApiError>): ApiError {
  return { code, message: ERROR_CATALOG[code].message, ...extra };
}

interface DatabaseLikeError {
  message?: string;
  detail?: string | null;
  code?: string;
}

/** Maps a PostgreSQL error to a safe ApiError. Unknown errors become server_error. */
export function fromDatabaseError(error: unknown): ApiError {
  const err = (error ?? {}) as DatabaseLikeError;
  const match = /^TP:([a-z_]+)$/.exec(err.message ?? "");
  if (match && isErrorCode(match[1])) {
    const code = match[1];
    const detail = Number.parseInt(err.detail ?? "", 10);
    if (Number.isFinite(detail)) {
      if (code === "rate_limited" || code === "session_rate_limited" || code === "account_locked") {
        return makeError(code, { retryAfter: detail });
      }
      if (code === "message_too_long") {
        return makeError(code, { limit: detail, message: `Message exceeds the ${detail}-character limit.` });
      }
    }
    return makeError(code);
  }
  if (err.code === "22P02") return makeError("invalid_request"); // invalid input syntax (e.g. uuid)
  return makeError("server_error");
}

export function isAppError(error: unknown): boolean {
  return /^TP:/.test((error as DatabaseLikeError | null)?.message ?? "");
}
