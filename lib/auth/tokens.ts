import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

const secure = process.env.NODE_ENV === "production";

/**
 * httpOnly cookies carrying random 256-bit tokens. Only their SHA-256 hashes
 * are stored in the database. `__Host-` prefix (HTTPS only) pins them to this
 * exact host and path.
 */
export const COOKIE = {
  visitor: secure ? "__Host-tp_visitor" : "tp_visitor",
  admin: secure ? "__Host-tp_admin" : "tp_admin",
} as const;

export const VISITOR_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days
export const ADMIN_TTL_HOURS = 12;

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** A visitor's 64-character hex private key (256 bits). Only its hash is stored. */
export function generatePrivateKey(): string {
  return randomBytes(32).toString("hex");
}

function isPlausibleToken(value: string | undefined): value is string {
  return !!value && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export async function readVisitorToken(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE.visitor)?.value;
  return isPlausibleToken(value) ? value : null;
}

export async function readAdminToken(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE.admin)?.value;
  return isPlausibleToken(value) ? value : null;
}

export async function setVisitorCookie(token: string) {
  (await cookies()).set(COOKIE.visitor, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: VISITOR_TTL_SECONDS,
  });
}

export async function setAdminCookie(token: string) {
  (await cookies()).set(COOKIE.admin, token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_TTL_HOURS * 3600,
  });
}

export async function clearCookie(name: string) {
  (await cookies()).set(name, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
}
