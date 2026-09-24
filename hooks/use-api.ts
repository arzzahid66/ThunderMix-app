"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import type { ApiError } from "@/lib/errors";

/**
 * GET a JSON endpoint of this app. `reload()` refetches without clearing the
 * current data (no loading flash); stale responses are discarded.
 */
export function useApi<T>(url: string | null) {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [loadedUrl, setLoadedUrl] = useState(url);
  const [generation, setGeneration] = useState(0);

  // A new URL means new data is loading (adjusting state during render,
  // rather than in an effect, avoids an extra render pass).
  if (url !== loadedUrl) {
    setLoadedUrl(url);
    setLoading(!!url);
  }

  useEffect(() => {
    if (!url) return;
    let stale = false;
    void apiRequest<T>(url).then((res) => {
      if (stale) return;
      if (res.ok) {
        setData(res.data);
        setError(null);
      } else {
        setError(res.error);
        if (res.error.code === "not_authenticated") router.replace("/admin/login");
      }
      setLoading(false);
    });
    return () => {
      stale = true;
    };
  }, [url, generation, router]);

  /** Refetch in the background, keeping the current data on screen. */
  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  return { data, error, loading, reload, setData };
}

/** Debounces a callback (used to coalesce bursts of realtime events into one refetch). */
export function useDebounced(fn: () => void, ms: number) {
  const fnRef = useRef(fn);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(), ms);
  }, [ms]);
}
