"use client";

import { useEffect, useRef, useState } from "react";
import type { ConnectionStatus } from "@/types";

type Handler = (data: unknown) => void;

export interface EventStreamOptions {
  /** Called after a *manual* reconnect (tab became visible again, recovery from a failed stream). Refetch state here. */
  onResync?: () => void;
  /** Stream reported that access is gone (e.g. `auth` event). The stream stays closed. */
  onFatal?: (data: unknown) => void;
  /** Close the stream after the tab has been hidden this long (saves DB compute). */
  hiddenGraceMs?: number;
}

const RECONNECTING_DELAY_MS = 3_000;

/**
 * Subscribes to one of the app's Server-Sent Event endpoints.
 *
 * - EventSource auto-reconnects (servers rotate streams every ~50s) and
 *   resumes via Last-Event-ID, so brief gaps lose nothing.
 * - Hard failures (non-200) are retried with exponential backoff.
 * - While the tab is hidden the stream is closed; on return it reopens from
 *   the last event id and `onResync` lets the caller reload from the database.
 * - The "reconnecting" status is only shown if a reconnect takes >3s, so the
 *   routine stream rotation does not flicker the indicator.
 */
export function useEventStream(
  url: string | null,
  handlers: Record<string, Handler>,
  options: EventStreamOptions = {},
): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const handlersRef = useRef(handlers);
  const optionsRef = useRef(options);

  useEffect(() => {
    handlersRef.current = handlers;
    optionsRef.current = options;
  });

  const eventNames = Object.keys(handlers).sort().join(",");

  useEffect(() => {
    if (!url) return;
    let source: EventSource | null = null;
    let disposed = false;
    let fatal = false;
    let lastId: string | null = null;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let statusTimer: ReturnType<typeof setTimeout> | undefined;
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;

    const names = eventNames ? eventNames.split(",") : [];

    const buildUrl = () => {
      if (!lastId) return url;
      const sep = url.includes("?") ? "&" : "?";
      return `${url}${sep}since=${encodeURIComponent(lastId)}`;
    };

    const markDegraded = () => {
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => {
        if (!disposed) setStatus(navigator.onLine ? "reconnecting" : "offline");
      }, RECONNECTING_DELAY_MS);
    };

    const close = () => {
      source?.close();
      source = null;
    };

    const open = (manual: boolean) => {
      if (disposed || fatal) return;
      close();
      const es = new EventSource(buildUrl());
      source = es;

      es.onopen = () => {
        clearTimeout(statusTimer);
        attempt = 0;
        setStatus("connected");
        if (manual) {
          manual = false;
          optionsRef.current.onResync?.();
        }
      };

      es.onerror = () => {
        if (es !== source) return;
        markDegraded();
        if (es.readyState === EventSource.CLOSED) {
          // The browser gave up (e.g. HTTP error). Retry ourselves with backoff.
          close();
          const delay = Math.min(30_000, 1_000 * 2 ** attempt++);
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => open(true), delay);
        }
      };

      const track = (e: MessageEvent) => {
        if (e.lastEventId) lastId = e.lastEventId;
      };
      es.addEventListener("hb", track as EventListener);
      es.addEventListener("ready", track as EventListener);
      es.addEventListener("auth", ((e: MessageEvent) => {
        fatal = true;
        close();
        clearTimeout(statusTimer);
        setStatus("offline");
        optionsRef.current.onFatal?.(safeParse(e.data));
      }) as EventListener);

      for (const name of names) {
        es.addEventListener(name, ((e: MessageEvent) => {
          track(e);
          handlersRef.current[name]?.(safeParse(e.data));
        }) as EventListener);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        clearTimeout(hiddenTimer);
        hiddenTimer = setTimeout(close, optionsRef.current.hiddenGraceMs ?? 60_000);
      } else {
        clearTimeout(hiddenTimer);
        if (!source && !fatal) open(true);
      }
    };
    const onOnline = () => {
      if (!fatal) open(true);
    };
    const onOffline = () => setStatus("offline");

    open(false);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearTimeout(statusTimer);
      clearTimeout(hiddenTimer);
      close();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [url, eventNames]);

  return status;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
