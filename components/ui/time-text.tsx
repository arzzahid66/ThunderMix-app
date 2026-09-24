"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { formatClock, formatDate, formatDateTime, formatRelative } from "@/lib/format";

type Mode = "clock" | "date" | "datetime" | "relative";

const formatters: Record<Mode, (iso: string) => string> = {
  clock: formatClock,
  date: formatDate,
  datetime: formatDateTime,
  relative: (iso) => formatRelative(iso),
};

const subscribeNoop = () => () => {};

/**
 * Formats timestamps in the viewer's local time zone. Renders nothing on the
 * server (time zones differ) to avoid hydration mismatches.
 */
export function TimeText({ iso, mode = "datetime", className }: { iso: string | null | undefined; mode?: Mode; className?: string }) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [, tick] = useState(0);

  useEffect(() => {
    if (mode !== "relative") return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [mode]);

  if (!iso) return <span className={className}>—</span>;
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning title={mounted ? formatDateTime(iso) : undefined}>
      {mounted ? formatters[mode](iso) : ""}
    </time>
  );
}
