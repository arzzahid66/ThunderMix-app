import type { NextRequest } from "next/server";

/**
 * Server-Sent Events over short-lived polling of PostgreSQL.
 *
 * Neon has no push channel usable from serverless functions, so each open
 * stream checks for rows whose `updated_at` advanced past a cursor every
 * POLL_MS. The cursor lags the database clock by OVERLAP_MS so rows from
 * transactions that committed slightly late are still picked up; rows already
 * sent (same id + version) are skipped. Streams end after LIFETIME_MS to stay
 * inside serverless duration limits, and the browser's EventSource reconnects
 * with Last-Event-ID so nothing is missed.
 */
export const POLL_MS = 2_000;
export const OVERLAP_MS = 4_000;
export const LIFETIME_MS = 50_000;
const MAX_LOOKBACK_MS = 15 * 60_000;

export interface StreamEvent {
  event: string;
  /** Dedupe key (e.g. "m:<id>") and version (e.g. updated_at). */
  key: string;
  version: string;
  data: unknown;
}

export interface PollResult {
  now: string;
  events: StreamEvent[];
  /** Send this event and end the stream permanently (e.g. access revoked). */
  stop?: { event: string; data: unknown };
}

export type Poller = (since: string) => Promise<PollResult>;

/** Resolve the starting cursor from Last-Event-ID (reconnect) or ?since=. */
export function initialCursor(request: NextRequest): string {
  const candidate = request.headers.get("last-event-id") ?? request.nextUrl.searchParams.get("since");
  const parsed = candidate ? Date.parse(candidate) : Number.NaN;
  const floor = Date.now() - MAX_LOOKBACK_MS;
  const ms = Number.isFinite(parsed) ? Math.max(parsed - OVERLAP_MS, floor) : Date.now() - OVERLAP_MS;
  return new Date(ms).toISOString();
}

function frame(event: string, data: unknown, id?: string) {
  return `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function pollingStream(request: NextRequest, poll: Poller): Response {
  const encoder = new TextEncoder();
  const sent = new Map<string, string>();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cursor = initialCursor(request);
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", close);

      write(`retry: 1500\n\n`);
      write(frame("ready", { at: new Date().toISOString() }));

      const tick = async () => {
        if (closed) return;
        try {
          const result = await poll(cursor);
          if (result.stop) {
            write(frame(result.stop.event, result.stop.data));
            close();
            return;
          }
          for (const e of result.events) {
            if (sent.get(e.key) === e.version) continue;
            sent.set(e.key, e.version);
            write(frame(e.event, e.data));
          }
          // Heartbeat that also carries the resume point for Last-Event-ID.
          write(frame("hb", {}, result.now));
          cursor = new Date(Date.parse(result.now) - OVERLAP_MS).toISOString();
          if (sent.size > 2_000) {
            for (const [key, version] of sent) if (version < cursor) sent.delete(key);
          }
        } catch (error) {
          console.error("[sse] poll failed", error);
          write(frame("stream-error", { code: "server_error" }));
        }

        if (Date.now() - started > LIFETIME_MS) {
          close(); // EventSource reconnects automatically after `retry`.
          return;
        }
        timer = setTimeout(tick, POLL_MS);
      };
      void tick();
    },
    cancel() {
      closed = true;
      clearTimeout(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
