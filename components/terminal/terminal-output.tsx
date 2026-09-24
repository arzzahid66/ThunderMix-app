"use client";

import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { TimeText } from "@/components/ui/time-text";
import { buildTimeline, isAwaitingResponse, type LocalLine } from "@/lib/terminal/timeline";
import type { PendingMessage } from "@/hooks/use-terminal-session";
import type { Message, VisitorSession } from "@/types";
import { Typewriter } from "./typewriter";

interface Props {
  handle: string;
  session: VisitorSession | null;
  messages: Message[];
  local: LocalLine[];
  pending: PendingMessage[];
  clearedAt: number;
  liveIds: Set<string>;
  confirmedIds: Set<string>;
  loading: boolean;
}

const localTone: Record<LocalLine["kind"], string> = {
  system: "text-neon-dim",
  info: "text-muted",
  warn: "text-amber",
  error: "text-danger",
  help: "text-ink/85",
  divider: "text-faint",
};

/** Renders the conversation as terminal output. All content is rendered as text (never HTML). */
export function TerminalOutput({ handle, session, messages, local, pending, clearedAt, liveIds, confirmedIds, loading }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);
  const [seenCount, setSeenCount] = useState(0);
  const [shownSession, setShownSession] = useState(session?.id);

  const timeline = useMemo(() => buildTimeline(messages, local, clearedAt), [messages, local, clearedAt]);
  const sentIds = useMemo(() => new Set(messages.map((m) => m.client_msg_id).filter(Boolean)), [messages]);
  const visiblePending = pending.filter((p) => !sentIds.has(p.clientMsgId));
  const awaiting = session?.status === "active" && isAwaitingResponse(messages) && !visiblePending.some((p) => p.status === "sending");

  const outputCount = timeline.length + visiblePending.length + (awaiting ? 1 : 0);
  // Switching sessions always starts pinned to the newest output.
  if (session?.id !== shownSession) {
    setShownSession(session?.id);
    setStuck(true);
  }
  const hasNew = !stuck && outputCount > seenCount;

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const nudge = useCallback(() => {
    if (stuck) scrollToBottom();
  }, [stuck, scrollToBottom]);

  // Follow new output while pinned to the bottom.
  useLayoutEffect(() => {
    if (stuck) scrollToBottom();
  }, [outputCount, stuck, session?.id, scrollToBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setStuck(atBottom);
    if (atBottom) setSeenCount(outputCount);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Terminal output"
        tabIndex={0}
        className="h-full overflow-y-auto overscroll-contain px-3 py-4 text-[13px] leading-relaxed sm:px-6 sm:text-sm"
      >
        {timeline.map((item) =>
          item.type === "local" ? (
            <LocalOutput key={item.key} line={item.line} />
          ) : (
            <MessageOutput
              key={item.key}
              message={item.message}
              handle={handle}
              live={liveIds.has(item.message.id)}
              confirmedLive={confirmedIds.has(item.message.id)}
              onProgress={nudge}
            />
          ),
        )}

        {loading && messages.length === 0 && (
          <p className="text-muted">
            <Spinner /> [ SYSTEM ] Retrieving transmission log…
          </p>
        )}

        {visiblePending.map((p) => (
          <div key={p.clientMsgId} className="mt-3 animate-reveal">
            <CommandLine handle={handle} content={p.content} dim={p.status === "sending"} />
            {p.status === "sending" ? (
              <p className="text-neon-dim">
                <Spinner /> [ SYSTEM ] Transmitting message…
              </p>
            ) : (
              <div className="text-danger">
                <p>[ ERROR ] Unable to transmit message. {p.error?.message}</p>
                <p className="text-muted">
                  {p.error?.code === "rate_limited" && p.error.retryAfter
                    ? `[ SYSTEM ] Rate limit reached. Retry in ${p.error.retryAfter}s. Press ↑ to recall the message.`
                    : "[ SYSTEM ] Please try again. Press ↑ to recall the message."}
                </p>
              </div>
            )}
          </div>
        ))}

        {awaiting && (
          <p className="mt-2 text-amber/90">
            <span className="animate-pulse-soft">[ SYSTEM ] Awaiting response…</span>
          </p>
        )}
      </div>

      {hasNew && !stuck && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-sm border border-cyan/50 bg-panel/95 px-3 py-1.5 text-[11px] uppercase tracking-wider text-cyan shadow-lg hover:bg-raised"
        >
          <ArrowDown className="size-3.5" aria-hidden="true" /> New output
        </button>
      )}
    </div>
  );
}

function CommandLine({ handle, content, dim }: { handle: string; content: string; dim?: boolean }) {
  return (
    <p className={`pre-wrap ${dim ? "opacity-70" : ""}`}>
      <span className="text-neon glow-neon">{handle}@terminal</span>
      <span className="text-faint">:</span>
      <span className="text-cyan">~</span>
      <span className="text-faint">$ </span>
      <span className="text-ink">{content}</span>
    </p>
  );
}

function LocalOutput({ line }: { line: LocalLine }) {
  if (line.kind === "divider") return <hr className="my-3 border-dashed border-line" />;
  return <p className={`pre-wrap animate-reveal ${localTone[line.kind]}`}>{line.text}</p>;
}

function MessageOutput({
  message,
  handle,
  live,
  confirmedLive,
  onProgress,
}: {
  message: Message;
  handle: string;
  live: boolean;
  confirmedLive: boolean;
  onProgress: () => void;
}) {
  if (message.sender_type === "user") {
    return (
      <div className="mt-3 animate-reveal">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <CommandLine handle={handle} content={message.content} />
          </div>
          <TimeText iso={message.created_at} mode="clock" className="shrink-0 pt-0.5 text-[11px] text-faint" />
        </div>
        {confirmedLive && <p className="text-neon-dim">[ SYSTEM ] Message received.</p>}
      </div>
    );
  }

  if (message.sender_type === "system") {
    return (
      <p className="mt-3 pre-wrap text-amber animate-reveal">
        [ SYSTEM ] {message.content}
      </p>
    );
  }

  return (
    <Fragment>
      <section aria-label="Incoming transmission" className="mt-4 animate-reveal border-l-2 border-cyan/40 pl-3">
        <p className="flex flex-wrap items-baseline gap-x-3 text-cyan glow-cyan">
          <span>[ INCOMING TRANSMISSION ]</span>
          <TimeText iso={message.created_at} mode="clock" className="text-[11px] text-cyan-dim [text-shadow:none]" />
        </p>
        <div className="my-2 text-ink">
          <Typewriter text={message.content} animate={live} onProgress={onProgress} />
        </div>
        <p className="text-cyan-dim">[ END OF TRANSMISSION ]</p>
      </section>
    </Fragment>
  );
}
