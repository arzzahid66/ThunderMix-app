"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * Reveals text character by character (capped at ~1.6s total). Screen readers
 * get the full text immediately; the animated copy is aria-hidden.
 */
export function Typewriter({
  text,
  animate,
  onProgress,
  className = "",
}: {
  text: string;
  animate: boolean;
  onProgress?: () => void;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const enabled = animate && !reduced;
  const [shown, setShown] = useState(enabled ? 0 : text.length);

  useEffect(() => {
    if (!enabled) return;
    const total = text.length;
    const duration = Math.min(1600, Math.max(250, total * 14));
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const n = Math.min(total, Math.ceil(((now - start) / duration) * total));
      setShown(n);
      onProgress?.();
      if (n < total) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // onProgress is a scroll nudge; re-running for identity changes is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, text]);

  const done = !enabled || shown >= text.length;
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="pre-wrap">
        {done ? text : text.slice(0, shown)}
        {!done && <span className="cursor-block ml-0.5 !h-[1em] !w-[0.5em]" />}
      </span>
    </span>
  );
}
