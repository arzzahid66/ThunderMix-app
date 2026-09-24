"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { inputCls } from "./primitives";

/** Text input that commits its value after the user pauses typing. */
export function SearchInput({
  id,
  label,
  value,
  placeholder,
  onCommit,
  className = "",
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [committed, setCommitted] = useState(value);

  // External value changed (e.g. "clear filters"): mirror it into the draft.
  if (value !== committed) {
    setCommitted(value);
    setDraft(value);
  }

  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onCommit(draft.trim()), 350);
    return () => clearTimeout(t);
  }, [draft, value, onCommit]);

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-[10px] uppercase tracking-[0.18em] text-faint">
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" aria-hidden="true" />
        <input
          id={id}
          type="search"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit(draft.trim());
          }}
          className={`${inputCls} w-full pl-8`}
        />
      </div>
    </div>
  );
}
