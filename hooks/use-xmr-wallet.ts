"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { ApiError } from "@/lib/errors";
import { WALLET_POLL_MS } from "@/lib/market/wallet";
import type { WalletQuote } from "@/types";

/**
 * Polls the visitor's wallet every 10 s while the tab is visible and exposes a
 * manual refresh. A failed poll keeps the last good quote on screen.
 */
export function useXmrWallet() {
  const [wallet, setWallet] = useState<WalletQuote | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    const res = await apiRequest<WalletQuote>("/api/visitor/wallet");
    busy.current = false;
    setLoading(false);
    if (res.ok) {
      setWallet(res.data);
      setError(null);
      setCheckedAt(Date.now());
    } else {
      setError(res.error);
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      void load();
      timer = setInterval(() => void load(), WALLET_POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  return { wallet, error, loading, checkedAt, refresh: load };
}
