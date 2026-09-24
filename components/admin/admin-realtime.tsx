"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEventStream } from "@/hooks/use-event-stream";
import type { AdminSessionRow, ConnectionStatus, Message } from "@/types";

export type AdminEvent =
  | { type: "message"; data: Message }
  | { type: "session"; data: AdminSessionRow }
  | { type: "user"; data: { id: string; status: string; updated_at: string } }
  | { type: "resync" };

type Listener = (event: AdminEvent) => void;

interface AdminRealtime {
  status: ConnectionStatus;
  subscribe: (listener: Listener) => () => void;
  /** Newest visitor messages that arrived live (for the toast). */
  incoming: Message[];
  dismissIncoming: (id: string) => void;
}

const Ctx = createContext<AdminRealtime | null>(null);

/** One SSE connection for the whole dashboard, fanned out to page-level listeners. */
export function AdminRealtimeProvider({ children }: { children: React.ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const seen = useRef(new Set<string>());
  const [incoming, setIncoming] = useState<Message[]>([]);
  const [since] = useState(() => new Date().toISOString());

  const emit = useCallback((event: AdminEvent) => {
    listeners.current.forEach((l) => l(event));
  }, []);

  const handlers = useMemo(
    () => ({
      message: (d: unknown) => {
        const m = d as Message;
        emit({ type: "message", data: m });
        if (m.sender_type === "user" && !seen.current.has(m.id)) {
          seen.current.add(m.id);
          setIncoming((prev) => [m, ...prev].slice(0, 3));
        }
      },
      session: (d: unknown) => emit({ type: "session", data: d as AdminSessionRow }),
      user: (d: unknown) => emit({ type: "user", data: d as { id: string; status: string; updated_at: string } }),
    }),
    [emit],
  );

  const router = useRouter();
  const status = useEventStream(`/api/admin/stream?since=${encodeURIComponent(since)}`, handlers, {
    onResync: () => emit({ type: "resync" }),
    onFatal: () => router.replace("/admin/login"),
    hiddenGraceMs: 5 * 60_000,
  });

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const dismissIncoming = useCallback((id: string) => setIncoming((prev) => prev.filter((m) => m.id !== id)), []);

  const value = useMemo(() => ({ status, subscribe, incoming, dismissIncoming }), [status, subscribe, incoming, dismissIncoming]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminRealtime() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdminRealtime must be used inside AdminRealtimeProvider");
  return ctx;
}

/** Subscribe to dashboard events for the lifetime of the component. */
export function useAdminEvents(listener: Listener) {
  const { subscribe } = useAdminRealtime();
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  });
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}
