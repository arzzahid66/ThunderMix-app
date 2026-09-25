"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, newClientId } from "@/lib/api-client";
import { makeError, type ApiError } from "@/lib/errors";
import { mergeMessages, mergeSessions, nextAnchor, type LocalLine } from "@/lib/terminal/timeline";
import { useEventStream } from "@/hooks/use-event-stream";
import type { ConnectionStatus, Message, PublicConfig, VisitorProfile, VisitorSession } from "@/types";

export interface PendingMessage {
  clientMsgId: string;
  content: string;
  status: "sending" | "failed";
  error?: ApiError;
}

interface Bootstrap {
  profile: VisitorProfile;
  sessions: VisitorSession[];
  config: PublicConfig;
  now: string;
}

const FATAL_CODES = new Set(["no_access", "not_authenticated"]);

/**
 * All client-side state of the visitor terminal. Each user has one continuous
 * conversation (their latest session): message history, optimistic sends, local terminal output and the live
 * event stream (with de-duplication by message id).
 */
export function useTerminalSession() {
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState<ApiError | null>(null);
  const [fatal, setFatal] = useState<ApiError | null>(null);
  const [profile, setProfile] = useState<VisitorProfile | null>(null);
  const [config, setConfig] = useState<PublicConfig>({ message_max_length: 2000, rate_limit_per_minute: 10 });
  const [sessions, setSessions] = useState<VisitorSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [local, setLocal] = useState<Record<string, LocalLine[]>>({});
  const [pending, setPending] = useState<Record<string, PendingMessage[]>>({});
  const [clearedAt, setClearedAt] = useState<Record<string, number>>({});
  const [liveIds, setLiveIds] = useState<Set<string>>(() => new Set());
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(() => new Set());
  const [streamSince, setStreamSince] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const messagesRef = useRef(messages);
  const localRef = useRef(local);
  const activeRef = useRef(activeId);
  const loadedRef = useRef(new Set<string>());
  const ackInFlight = useRef(new Set<string>());
  useEffect(() => {
    messagesRef.current = messages;
    localRef.current = local;
    activeRef.current = activeId;
  });

  // ------------------------------------------------------------ local output
  const addLocal = useCallback((sessionId: string, kind: LocalLine["kind"], lines: string | string[]) => {
    const texts = Array.isArray(lines) ? lines : [lines];
    setLocal((prev) => {
      const current = prev[sessionId] ?? [];
      const out = [...current];
      let at = nextAnchor(messagesRef.current[sessionId] ?? [], current);
      for (const text of texts) {
        out.push({ id: newClientId(), kind, text, at });
        at += 0.001;
      }
      return { ...prev, [sessionId]: out };
    });
  }, []);

  const handleFatal = useCallback((error: ApiError) => {
    if (FATAL_CODES.has(error.code) || error.code === "user_blocked") setFatal(error);
  }, []);

  // --------------------------------------------------------------- loading
  const loadMessages = useCallback(
    async (sessionId: string) => {
      setLoading((p) => ({ ...p, [sessionId]: true }));
      const res = await apiRequest<{ messages: Message[]; now: string }>(`/api/visitor/sessions/${sessionId}/messages`);
      setLoading((p) => ({ ...p, [sessionId]: false }));
      if (!res.ok) {
        handleFatal(res.error);
        addLocal(sessionId, "error", [`[ ERROR ] ${res.error.message}`, "[ SYSTEM ] Please try again."]);
        return;
      }
      loadedRef.current.add(sessionId);
      setMessages((prev) => ({ ...prev, [sessionId]: mergeMessages(prev[sessionId] ?? [], res.data.messages) }));
    },
    [addLocal, handleFatal],
  );

  const refreshSessions = useCallback(async () => {
    const res = await apiRequest<Bootstrap>("/api/visitor/sessions");
    if (!res.ok) {
      handleFatal(res.error);
      return null;
    }
    setProfile(res.data.profile);
    setConfig(res.data.config);
    // Authoritative list: also drops sessions deleted in another tab.
    setSessions(mergeSessions([], res.data.sessions));
    return res.data;
  }, [handleFatal]);

  const introduce = useCallback(
    (session: VisitorSession, fresh: boolean) => {
      addLocal(session.id, "system", [
        `[ SYSTEM ] ${fresh ? "Secure channel established." : "Conversation restored."}`,
        "[ SYSTEM ] Type a message and press ENTER to transmit. Type /help for commands.",
      ]);
    },
    [addLocal],
  );

  const createSession = useCallback(async () => {
    if (creating) return null;
    setCreating(true);
    const res = await apiRequest<VisitorSession>("/api/visitor/sessions", { method: "POST", body: {} });
    setCreating(false);
    const current = activeRef.current;
    if (!res.ok) {
      handleFatal(res.error);
      if (current) {
        const retry = res.error.retryAfter ? ` Retry in ${Math.ceil(res.error.retryAfter / 60)} min.` : "";
        addLocal(current, "error", `[ ERROR ] Unable to start a new conversation. ${res.error.message}${retry}`);
      }
      return null;
    }
    const session = res.data;
    loadedRef.current.add(session.id);
    setSessions((prev) => mergeSessions(prev, [session]));
    setMessages((prev) => ({ ...prev, [session.id]: [] }));
    introduce(session, true);
    setActiveId(session.id);
    return session;
  }, [creating, addLocal, handleFatal, introduce]);

  // -------------------------------------------------------------- bootstrap
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiRequest<Bootstrap>("/api/visitor/sessions");
      if (cancelled) return;
      if (!res.ok) {
        setBootError(res.error);
        handleFatal(res.error);
        setBooted(true);
        return;
      }
      const data = res.data;
      setProfile(data.profile);
      setConfig(data.config);
      setStreamSince(data.now);
      const sorted = mergeSessions([], data.sessions);
      setSessions(sorted);

      // The user's conversation: the latest open session (else the latest one).
      const target = sorted.find((s) => s.status === "active") ?? sorted[0];
      setBooted(true);

      if (!target) {
        if (data.profile.status === "active") {
          const created = await apiRequest<VisitorSession>("/api/visitor/sessions", { method: "POST", body: {} });
          if (cancelled) return;
          if (created.ok) {
            loadedRef.current.add(created.data.id);
            setSessions((prev) => mergeSessions(prev, [created.data]));
            setMessages((prev) => ({ ...prev, [created.data.id]: [] }));
            introduce(created.data, true);
            setActiveId(created.data.id);
          } else {
            setBootError(created.error);
          }
        }
        return;
      }
      loadedRef.current.add(target.id);
      introduce(target, target.message_count === 0);
      setActiveId(target.id);
      void loadMessages(target.id);
    })();
    return () => {
      cancelled = true;
    };
    // Bootstrap once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------ send
  const send = useCallback(
    async (raw: string): Promise<boolean> => {
      const sessionId = activeRef.current;
      if (!sessionId) return false;
      const content = raw.replace(/\r\n?/g, "\n").trim();
      const session = sessions.find((s) => s.id === sessionId);

      if (!content) {
        addLocal(sessionId, "error", "[ ERROR ] Cannot transmit an empty message.");
        return false;
      }
      if (content.length > config.message_max_length) {
        addLocal(
          sessionId,
          "error",
          `[ ERROR ] Message is ${content.length} characters; the limit is ${config.message_max_length}.`,
        );
        return false;
      }
      if (session?.status === "closed") {
        addLocal(sessionId, "error", "[ ERROR ] This conversation is closed. Start a new conversation to continue.");
        return false;
      }
      if (profile?.status === "blocked") {
        addLocal(sessionId, "error", "[ ERROR ] Access to this portal has been restricted.");
        return false;
      }

      const clientMsgId = newClientId();
      setPending((p) => ({
        ...p,
        [sessionId]: [...(p[sessionId] ?? []), { clientMsgId, content, status: "sending" }],
      }));

      const res = await apiRequest<Message>("/api/visitor/messages", {
        method: "POST",
        body: { sessionId, content, clientMsgId },
      });

      if (res.ok) {
        setConfirmedIds((prev) => new Set(prev).add(res.data.id));
        setMessages((prev) => ({ ...prev, [sessionId]: mergeMessages(prev[sessionId] ?? [], [res.data]) }));
        setPending((p) => ({ ...p, [sessionId]: (p[sessionId] ?? []).filter((m) => m.clientMsgId !== clientMsgId) }));
        return true;
      }

      const error = res.error.code === "network_error" ? makeError("network_error") : res.error;
      setPending((p) => ({
        ...p,
        [sessionId]: (p[sessionId] ?? []).map((m) =>
          m.clientMsgId === clientMsgId ? { ...m, status: "failed", error } : m,
        ),
      }));
      handleFatal(error);
      if (error.code === "session_closed") void refreshSessions();
      return true;
    },
    [sessions, config.message_max_length, profile?.status, addLocal, handleFatal, refreshSessions],
  );

  const dismissFailed = useCallback((sessionId: string, clientMsgId: string) => {
    setPending((p) => ({ ...p, [sessionId]: (p[sessionId] ?? []).filter((m) => m.clientMsgId !== clientMsgId) }));
  }, []);

  const clearScreen = useCallback((sessionId: string) => {
    const at = nextAnchor(messagesRef.current[sessionId] ?? [], localRef.current[sessionId] ?? []);
    setClearedAt((p) => ({ ...p, [sessionId]: at }));
    setPending((p) => ({ ...p, [sessionId]: (p[sessionId] ?? []).filter((m) => m.status === "sending") }));
  }, []);

  // ------------------------------------------------------------- realtime
  const onMessage = useCallback((data: unknown) => {
    const m = data as Message;
    if (!m?.id || !m.session_id) return;
    const known = (messagesRef.current[m.session_id] ?? []).some((x) => x.id === m.id);
    if (!known && m.sender_type !== "user") setLiveIds((prev) => new Set(prev).add(m.id));
    if (loadedRef.current.has(m.session_id)) {
      setMessages((prev) => ({ ...prev, [m.session_id]: mergeMessages(prev[m.session_id] ?? [], [m]) }));
    }
  }, []);

  const onSession = useCallback((data: unknown) => {
    const s = data as VisitorSession;
    if (!s?.id) return;
    setSessions((prev) => mergeSessions(prev, [s]));
  }, []);

  const onProfile = useCallback((data: unknown) => {
    const p = data as VisitorProfile;
    if (p?.status) setProfile(p);
  }, []);

  const resync = useCallback(async () => {
    await refreshSessions();
    const current = activeRef.current;
    if (current) await loadMessages(current);
  }, [refreshSessions, loadMessages]);

  const handlers = useMemo(
    () => ({ message: onMessage, session: onSession, profile: onProfile }),
    [onMessage, onSession, onProfile],
  );

  const status: ConnectionStatus = useEventStream(
    streamSince && !fatal ? `/api/visitor/stream?since=${encodeURIComponent(streamSince)}` : null,
    handlers,
    {
      onResync: () => void resync(),
      onFatal: (data) => setFatal((data as ApiError) ?? makeError("no_access")),
    },
  );

  // ---------------------------------------------------- read receipts (ack)
  useEffect(() => {
    if (!activeId) return;
    const list = messages[activeId] ?? [];
    const unacked = list.some((m) => m.sender_type === "admin" && m.delivery_status !== "read");
    if (!unacked || ackInFlight.current.has(activeId)) return;
    const visible = typeof document !== "undefined" && document.visibilityState === "visible";
    ackInFlight.current.add(activeId);
    const sessionId = activeId;
    void apiRequest("/api/visitor/ack", {
      method: "POST",
      body: { sessionId, status: visible ? "read" : "delivered" },
    }).finally(() => {
      setTimeout(() => ackInFlight.current.delete(sessionId), visible ? 1_500 : 10_000);
    });
  }, [activeId, messages]);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  return {
    booted,
    bootError,
    fatal,
    profile,
    config,
    sessions,
    activeSession,
    activeId,
    messages: activeId ? (messages[activeId] ?? []) : [],
    messagesLoading: activeId ? !!loading[activeId] : false,
    local: activeId ? (local[activeId] ?? []) : [],
    pending: activeId ? (pending[activeId] ?? []) : [],
    clearedAt: activeId ? (clearedAt[activeId] ?? 0) : 0,
    liveIds,
    confirmedIds,
    status,
    creating,
    createSession,
    send,
    addLocal,
    clearScreen,
    dismissFailed,
  };
}

export type TerminalController = ReturnType<typeof useTerminalSession>;
