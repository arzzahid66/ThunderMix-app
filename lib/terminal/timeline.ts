import type { Message, VisitorSession } from "@/types";

/** Inserts/updates messages by id (newer `updated_at` wins), sorted by creation time. */
export function mergeMessages(current: readonly Message[], incoming: readonly Message[]): Message[] {
  if (!incoming.length) return current as Message[];
  const byId = new Map(current.map((m) => [m.id, m]));
  let changed = false;
  for (const m of incoming) {
    const existing = byId.get(m.id);
    if (!existing || existing.updated_at < m.updated_at || (existing.updated_at === m.updated_at && existing !== m && !sameMessage(existing, m))) {
      byId.set(m.id, m);
      changed = true;
    }
  }
  if (!changed) return current as Message[];
  return [...byId.values()].sort(compareMessages);
}

function sameMessage(a: Message, b: Message) {
  return a.delivery_status === b.delivery_status && a.content === b.content;
}

export function compareMessages(a: Message, b: Message) {
  const t = Date.parse(a.created_at) - Date.parse(b.created_at);
  return t !== 0 ? t : a.id.localeCompare(b.id);
}

/** Upserts sessions by id and keeps them sorted by latest activity. */
export function mergeSessions<T extends VisitorSession>(current: readonly T[], incoming: readonly T[]): T[] {
  if (!incoming.length) return current as T[];
  const byId = new Map(current.map((s) => [s.id, s]));
  for (const s of incoming) {
    const existing = byId.get(s.id);
    if (!existing || existing.updated_at <= s.updated_at) byId.set(s.id, { ...existing, ...s });
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at));
}

export interface LocalLine {
  id: string;
  kind: "system" | "info" | "warn" | "error" | "help" | "divider";
  text: string;
  /** Sort key (ms); anchored after the last item visible when it was added. */
  at: number;
}

export type TimelineItem =
  | { type: "message"; key: string; at: number; message: Message }
  | { type: "local"; key: string; at: number; line: LocalLine };

/** Interleaves stored messages with local-only terminal lines. */
export function buildTimeline(messages: readonly Message[], local: readonly LocalLine[], clearedAt = 0): TimelineItem[] {
  const items: TimelineItem[] = [
    ...messages.map((m) => ({ type: "message" as const, key: m.id, at: Date.parse(m.created_at), message: m })),
    ...local.map((l) => ({ type: "local" as const, key: l.id, at: l.at, line: l })),
  ];
  return items
    .filter((i) => i.at > clearedAt)
    .sort((a, b) => a.at - b.at || (a.type === b.type ? 0 : a.type === "message" ? -1 : 1));
}

/** Sort key for a new local line: just after everything currently shown. */
export function nextAnchor(messages: readonly Message[], local: readonly LocalLine[]): number {
  const lastMsg = messages.length ? Date.parse(messages[messages.length - 1].created_at) : 0;
  const lastLocal = local.length ? local[local.length - 1].at : 0;
  // Anchored to server timestamps only, so client clock skew cannot reorder output.
  return Math.max(lastMsg, lastLocal) + 0.001;
}

/** True when the visitor's latest message has not been answered yet. */
export function isAwaitingResponse(messages: readonly Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const s = messages[i].sender_type;
    if (s === "admin") return false;
    if (s === "user") return true;
  }
  return false;
}
