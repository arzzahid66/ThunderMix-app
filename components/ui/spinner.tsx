"use client";

import { useEffect, useState } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Braille terminal spinner. Decorative: pair it with visible text. */
export function Spinner({ className = "" }: { className?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return (
    <span aria-hidden="true" className={`inline-block w-[1ch] ${className}`}>
      {FRAMES[i]}
    </span>
  );
}
