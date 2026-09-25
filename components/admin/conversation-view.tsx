"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, CheckCircle2, CornerDownLeft, Lock, Trash2, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, SessionStatusBadge, UserStatusBadge } from "@/components/ui/status-badge";
import { Spinner } from "@/components/ui/spinner";
import { TimeText } from "@/components/ui/time-text";
import { apiRequest, newClientId } from "@/lib/api-client";
import type { ApiError } from "@/lib/errors";
import { isAwaitingResponse, mergeMessages } from "@/lib/terminal/timeline";
import { useApi, useDebounced } from "@/hooks/use-api";
import type { AdminSessionRow, Message } from "@/types";
import { useAdminEvents } from "./admin-realtime";
import { ErrorNotice, inputCls } from "./primitives";

interface Detail {
  session: AdminSessionRow;
  messages: Message[];
  now: string;
}

interface PendingReply {
  clientMsgId: string;
  content: string;
  status: "sending" | "failed";
  error?: ApiError;
}

const DEFAULT_MAX = 2000;

export function ConversationView({ id }: { id: string }) {
  return (
    <div className="flex h-[calc(100dvh-3.25rem)] lg:h-dvh">
      <SessionQueue currentId={id} />
      <Conversation key={id} id={id} />
    </div>
  );
}

// ---------------------------------------------------------------- queue ---

function SessionQueue({ currentId }: { currentId: string }) {
  const [scope, setScope] = useState<"awaiting" | "active" | "all">("active");
  const qs = scope === "awaiting" ? "unanswered=1" : scope === "active" ? "status=active" : "";
  const queue = useApi<{ rows: AdminSessionRow[]; total: number }>(`/api/admin/sessions?sort=queue&pageSize=50&${qs}`);
  const refresh = useDebounced(() => void queue.reload(), 600);
  useAdminEvents((e) => {
    if (e.type !== "user") refresh();
  });

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r border-line bg-panel/60 xl:flex" aria-label="Session queue">
      <div className="border-b border-line p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted">Queue</h2>
          <Link href="/admin/sessions" className="text-[10px] uppercase tracking-wider text-faint hover:text-cyan">All sessions</Link>
        </div>
        <div className="mt-2 flex gap-1" role="group" aria-label="Queue filter">
          {(["awaiting", "active", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              aria-pressed={scope === s}
              className={`flex-1 rounded-sm border px-2 py-1 text-[10px] uppercase tracking-wider ${
                scope === s ? "border-cyan/50 bg-cyan/10 text-cyan" : "border-line text-faint hover:text-ink"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {queue.loading && !queue.data && (
          <li className="p-3 text-xs text-muted">
            <Spinner /> Loading…
          </li>
        )}
        {queue.data?.rows.length === 0 && <li className="p-4 text-center text-xs text-faint">Nothing here.</li>}
        {queue.data?.rows.map((s) => {
          const active = s.id === currentId;
          return (
            <li key={s.id}>
              <Link
                href={`/admin/sessions/${s.id}`}
                aria-current={active ? "page" : undefined}
                className={`mb-1 block rounded-sm border px-3 py-2 transition-colors ${
                  active ? "border-neon/40 bg-neon/[0.06]" : "border-transparent hover:border-line hover:bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate text-[13px] ${active ? "text-neon" : "text-ink"}`}>{s.user_name}</span>
                  {s.unanswered_count > 0 && (
                    <span className="shrink-0 rounded-sm border border-amber/40 bg-amber/10 px-1.5 text-[10px] text-amber">
                      {s.unanswered_count}
                      <span className="sr-only"> unanswered</span>
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-faint">
                  <span>{s.session_code}</span>
                  <TimeText iso={s.last_activity_at} mode="relative" />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// --------------------------------------------------------- conversation ---

function Conversation({ id }: { id: string }) {
  const router = useRouter();
  const detail = useApi<Detail>(`/api/admin/sessions/${id}`);
  const settings = useApi<{ config: { message_max_length: number } }>("/api/admin/settings");
  const maxLength = settings.data?.config.message_max_length ?? DEFAULT_MAX;

  // Live updates received since the last fetch; merged over the fetched data.
  const [liveMessages, setLiveMessages] = useState<Message[]>([]);
  const [livePatch, setLivePatch] = useState<Partial<AdminSessionRow> & { updated_at?: string }>({});
  const [pending, setPending] = useState<PendingReply[]>([]);
  const draftKey = `tp:draft:${id}`;
  // Per-session draft (component is keyed by session id, so this runs per session).
  const [draft, setDraft] = useState(() => {
    try {
      return typeof window === "undefined" ? "" : (sessionStorage.getItem(draftKey) ?? "");
    } catch {
      return "";
    }
  });
  const [dialog, setDialog] = useState<"close" | "block" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stuckRef = useRef(true);

  useEffect(() => {
    try {
      if (draft) sessionStorage.setItem(draftKey, draft);
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* storage unavailable */
    }
  }, [draft, draftKey]);

  const messages = useMemo(
    () => mergeMessages(detail.data?.messages ?? [], liveMessages),
    [detail.data, liveMessages],
  );
  const session = useMemo<AdminSessionRow | null>(() => {
    const base = detail.data?.session;
    if (!base) return null;
    const newer = !livePatch.updated_at || livePatch.updated_at >= base.updated_at;
    return newer ? { ...base, ...livePatch } : base;
  }, [detail.data, livePatch]);
  const setMessages = (incoming: Message[]) => setLiveMessages((prev) => mergeMessages(prev, incoming));

  const markRead = useDebounced(() => {
    if (document.visibilityState === "visible") void apiRequest(`/api/admin/sessions/${id}/read`, { method: "POST", body: {} });
  }, 500);

  // Mark visitor messages read while the operator is looking at them.
  useEffect(() => {
    if (messages.some((m) => m.sender_type === "user" && m.delivery_status !== "read")) markRead();
  }, [messages, markRead]);

  useAdminEvents((e) => {
    if (e.type === "message" && e.data.session_id === id) {
      setMessages([e.data]);
    } else if (e.type === "session" && e.data.id === id) {
      setLivePatch(e.data);
    } else if (e.type === "user" && session && e.data.id === session.user_id) {
      setLivePatch((prev) => ({ ...prev, user_status: e.data.status as AdminSessionRow["user_status"] }));
    } else if (e.type === "resync") {
      void detail.reload();
    }
  });

  // Auto-scroll when new output arrives and the operator is at the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stuckRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending.length]);

  const sentKeys = useMemo(() => new Set(messages.map((m) => m.client_msg_id)), [messages]);
  const visiblePending = pending.filter((p) => !sentKeys.has(p.clientMsgId));

  const sendReply = useCallback(async () => {
    const content = draft.trim();
    if (!content || content.length > maxLength || !session || session.status === "closed") return;
    const clientMsgId = newClientId();
    setPending((p) => [...p, { clientMsgId, content, status: "sending" }]);
    setDraft("");
    stuckRef.current = true;
    const res = await apiRequest<Message>(`/api/admin/sessions/${id}/reply`, {
      method: "POST",
      body: { content, clientMsgId },
    });
    if (res.ok) {
      setMessages([res.data]);
      setPending((p) => p.filter((x) => x.clientMsgId !== clientMsgId));
    } else {
      setPending((p) => p.map((x) => (x.clientMsgId === clientMsgId ? { ...x, status: "failed", error: res.error } : x)));
    }
    textareaRef.current?.focus();
  }, [draft, maxLength, session, id]);

  const retry = (p: PendingReply) => {
    setPending((list) => list.filter((x) => x.clientMsgId !== p.clientMsgId));
    setDraft(p.content);
    textareaRef.current?.focus();
  };

  const runAction = async (fn: () => Promise<{ ok: boolean; error?: ApiError }>, after?: () => void) => {
    setBusy(true);
    setActionError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      setActionError(res.error?.message ?? "Action failed.");
      return;
    }
    setDialog(null);
    after?.();
    void detail.reload();
  };

  if (detail.error?.code === "session_not_found") {
    return (
      <div className="flex-1 p-8 text-sm">
        <p className="text-danger">[ ERROR ] Session not found. It may have been deleted.</p>
        <Link href="/admin/sessions" className="mt-3 inline-block text-cyan hover:underline">← Back to sessions</Link>
      </div>
    );
  }

  const awaiting = isAwaitingResponse(messages);
  const closed = session?.status === "closed";
  const count = draft.length;

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label="Conversation monitor">
      {/* Header */}
      <header className="border-b border-line bg-panel/80 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1 text-[12px] leading-relaxed">
            <Link href="/admin/sessions" className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-faint hover:text-ink xl:hidden">
              <ArrowLeft className="size-3" aria-hidden="true" /> Sessions
            </Link>
            {session ? (
              <>
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-muted">SESSION:</span>
                  <span className="text-cyan">{session.session_code}</span>
                  <SessionStatusBadge status={session.status} />
                  {session.user_status === "blocked" && <UserStatusBadge status="blocked" />}
                  {session.visitor_hidden_at && (
                    <Badge tone="muted" glyph="⌫">
                      Deleted by visitor
                    </Badge>
                  )}
                </p>
                <p className="truncate">
                  <span className="text-muted">USER: </span>
                  <Link href={`/admin/users/${session.user_id}`} className="text-ink hover:text-neon hover:underline">
                    {session.user_name}
                  </Link>
                  <span className="text-muted"> · KEY: </span>
                  <span className="font-mono text-ink">…{session.user_key_hint}</span>
                </p>
                <p className="text-muted">
                  CREATED: <TimeText iso={session.created_at} mode="datetime" className="text-ink" /> · {session.message_count} messages
                </p>
              </>
            ) : (
              <p className="text-muted">
                <Spinner /> Loading session…
              </p>
            )}
          </div>
          {session && (
            <div className="flex flex-wrap gap-2">
              {session.visitor_hidden_at ? null : closed ? (
                <Button size="sm" variant="primary" disabled={busy} onClick={() => void runAction(() => apiRequest(`/api/admin/sessions/${id}`, { method: "PATCH", body: { status: "active" } }))}>
                  <Unlock className="size-3.5" aria-hidden="true" /> Reopen
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setDialog("close")}>
                  <Lock className="size-3.5" aria-hidden="true" /> Close
                </Button>
              )}
              {session.user_status === "active" ? (
                <Button size="sm" variant="ghost" onClick={() => setDialog("block")}>
                  <Ban className="size-3.5" aria-hidden="true" /> Block user
                </Button>
              ) : (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void runAction(() => apiRequest(`/api/admin/users/${session.user_id}`, { method: "PATCH", body: { status: "active" } }))}>
                  <CheckCircle2 className="size-3.5" aria-hidden="true" /> Unblock
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setDialog("delete")} aria-label="Delete session">
                <Trash2 className="size-3.5 text-danger" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
        {actionError && !dialog && <p role="alert" className="mt-2 text-xs text-danger">[ ERROR ] {actionError}</p>}
      </header>

      {/* Log */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stuckRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto bg-grid px-4 py-4 text-[13px] leading-relaxed sm:px-6"
      >
        {detail.error && (
          <ErrorNotice message={detail.error.message} onRetry={() => void detail.reload()} />
        )}
        {detail.loading && !detail.data && (
          <p className="text-muted">
            <Spinner /> Loading conversation…
          </p>
        )}
        {detail.data && messages.length === 0 && <p className="text-faint">[ EMPTY ] No messages in this session yet.</p>}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const divider = m.sender_type === "user" && prev && prev.sender_type !== "user";
          return (
            <div key={m.id}>
              {divider && <div className="my-4 border-t border-dashed border-line" aria-hidden="true" />}
              <ConversationMessage message={m} />
            </div>
          );
        })}

        {visiblePending.map((p) => (
          <div key={p.clientMsgId} className="mt-3">
            <p className="text-[11px] uppercase tracking-wider text-cyan/70">[ADMIN] {p.status === "sending" ? <><Spinner /> sending…</> : null}</p>
            <p className="pre-wrap text-ink/70">{p.content}</p>
            {p.status === "failed" && (
              <p className="text-xs text-danger">
                [ ERROR ] {p.error?.message ?? "Unable to send."}{" "}
                <button type="button" onClick={() => retry(p)} className="underline underline-offset-2 hover:text-ink">
                  Edit &amp; retry
                </button>
              </p>
            )}
          </div>
        ))}

        {awaiting && !closed && visiblePending.length === 0 && (
          <p className="mt-4 text-amber">
            <span className="animate-pulse-soft">[STATUS] Awaiting response…</span>
          </p>
        )}
      </div>

      {/* Reply — rendered after load because the draft comes from sessionStorage. */}
      {session && (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendReply();
        }}
        className="border-t border-line bg-panel/80 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6"
      >
        <label htmlFor="reply" className="mb-1.5 block text-[10px] uppercase tracking-[0.18em] text-faint">
          Reply to visitor <span className="normal-case tracking-normal">(shown as an anonymous “incoming transmission”)</span>
        </label>
        <div className="flex items-end gap-2">
          <span aria-hidden="true" className="pb-2 text-cyan">&gt;</span>
          <textarea
            id="reply"
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void sendReply();
              }
            }}
            rows={3}
            disabled={closed || !session}
            placeholder={closed ? "Session closed — reopen it to reply." : "Type a reply…"}
            aria-describedby="reply-hint"
            aria-invalid={count > maxLength}
            className={`${inputCls} h-auto min-h-[4.5rem] flex-1 resize-y py-2 leading-relaxed caret-cyan disabled:opacity-50`}
          />
          <Button type="submit" variant="primary" disabled={!draft.trim() || count > maxLength || closed || !session}>
            <CornerDownLeft className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Send</span>
          </Button>
        </div>
        <div id="reply-hint" className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wider text-faint">
          <span>Enter send · Shift+Enter newline · drafts are kept per session</span>
          <span className={count > maxLength ? "text-danger" : count > maxLength * 0.9 ? "text-amber" : ""}>
            {count}/{maxLength}
          </span>
        </div>
      </form>
      )}

      <ConfirmDialog
        open={dialog === "close"}
        tone="primary"
        title="Close session"
        description="The visitor will see that this session is closed and can no longer send messages in it. They can open a new session. You can reopen it later."
        confirmLabel="Close session"
        busy={busy}
        error={actionError}
        onCancel={() => setDialog(null)}
        onConfirm={() => void runAction(() => apiRequest(`/api/admin/sessions/${id}`, { method: "PATCH", body: { status: "closed" } }))}
      />
      <ConfirmDialog
        open={dialog === "block"}
        title="Block user"
        description={
          <>
            <span className="text-ink">{session?.user_name}</span> will be unable to send messages or open sessions from any
            browser. History is kept and you can unblock later.
          </>
        }
        confirmLabel="Block user"
        busy={busy}
        error={actionError}
        onCancel={() => setDialog(null)}
        onConfirm={() => void runAction(() => apiRequest(`/api/admin/users/${session?.user_id}`, { method: "PATCH", body: { status: "blocked" } }))}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        title="Delete session permanently"
        description="This permanently deletes the session and all of its messages. The user record is kept. This cannot be undone."
        confirmLabel="Delete session"
        requireText={session?.session_code}
        busy={busy}
        error={actionError}
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          void runAction(
            () => apiRequest(`/api/admin/sessions/${id}`, { method: "DELETE" }),
            () => router.replace("/admin/sessions"),
          )
        }
      />
    </section>
  );
}

function ConversationMessage({ message: m }: { message: Message }) {
  if (m.sender_type === "system") {
    return (
      <p className="mt-3 text-amber">
        [SYSTEM] <TimeText iso={m.created_at} mode="clock" className="text-faint" /> {m.content}
      </p>
    );
  }
  const isUser = m.sender_type === "user";
  const delivery = { sent: "✓ sent", delivered: "✓✓ delivered", read: "✓✓ read" }[m.delivery_status];
  return (
    <div className="mt-3">
      <p className="flex flex-wrap items-baseline gap-x-2 text-[11px] uppercase tracking-wider">
        <span className={isUser ? "text-neon" : "text-cyan"}>[{isUser ? "USER" : "ADMIN"}]</span>
        <TimeText iso={m.created_at} mode="clock" className="text-faint" />
        {!isUser && (
          <span className={m.delivery_status === "read" ? "text-cyan-dim" : "text-faint"} title="Delivery status">
            {delivery}
          </span>
        )}
      </p>
      <p className={`pre-wrap ${isUser ? "text-ink" : "text-ink/85"}`}>{m.content}</p>
    </div>
  );
}
