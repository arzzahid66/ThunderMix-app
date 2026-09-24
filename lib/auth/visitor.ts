import { callJson, withDb } from "@/lib/db/pool";
import type { VisitorProfile } from "@/types";
import { readVisitorToken } from "./tokens";

/** The profile linked to this browser's token, or null. */
export async function getVisitorProfile(): Promise<{ token: string; profile: VisitorProfile } | null> {
  const token = await readVisitorToken();
  if (!token) return null;
  const profile = await withDb({ visitorToken: token }, (c) =>
    callJson<VisitorProfile | null>(c, "select public.visitor_me()"),
  );
  return profile ? { token, profile } : null;
}
