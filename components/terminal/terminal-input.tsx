"use client";

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";

export interface TerminalInputHandle {
  focus: () => void;
  setValue: (value: string) => void;
}

interface Props {
  handle: string;
  maxLength: number;
  disabled?: boolean;
  disabledReason?: string;
  /** Return true when the input should be cleared (message accepted for sending). */
  onSubmit: (value: string) => Promise<boolean> | boolean;
  /** Previously entered lines, newest last (↑/↓ history). */
  history: string[];
}

const MAX_ROWS = 6;

export const TerminalInput = forwardRef<TerminalInputHandle, Props>(function TerminalInput(
  { handle, maxLength, disabled, disabledReason, onSubmit, history },
  ref,
) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    setValue: (v: string) => setValue(v),
  }));

  // Auto-grow up to MAX_ROWS lines.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_ROWS)}px`;
  }, [value]);

  const submit = async () => {
    if (disabled || submitting) return;
    // Guard against double-Enter: clear immediately, restore if rejected.
    const current = value;
    setSubmitting(true);
    setValue("");
    setHistoryIndex(null);
    const accepted = await onSubmit(current);
    setSubmitting(false);
    if (!accepted) setValue(current);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
      return;
    }
    const el = e.currentTarget;
    const singleLine = !value.includes("\n");
    if (e.key === "ArrowUp" && singleLine && el.selectionStart === 0 && history.length) {
      e.preventDefault();
      const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setValue(history[next]);
    } else if (e.key === "ArrowUp" && singleLine && !value && history.length) {
      e.preventDefault();
      setHistoryIndex(history.length - 1);
      setValue(history[history.length - 1]);
    } else if (e.key === "ArrowDown" && historyIndex !== null && singleLine) {
      e.preventDefault();
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(null);
        setValue("");
      } else {
        setHistoryIndex(next);
        setValue(history[next]);
      }
    } else if (e.key === "Escape") {
      setValue("");
      setHistoryIndex(null);
    }
  };

  const count = value.length;
  const over = count > maxLength;
  const near = count > maxLength * 0.9;

  return (
    <div className="border-t border-line bg-panel/80 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur sm:px-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex items-start gap-2"
        onClick={() => textareaRef.current?.focus()}
      >
        <label htmlFor="terminal-input" className="shrink-0 select-none pt-[3px] text-[13px] sm:text-sm">
          {/* Full prompt on larger screens; compact on phones to leave room for typing. */}
          <span className="hidden sm:inline">
            <span className="text-neon glow-neon">{handle}@terminal</span>
            <span className="text-faint">:</span>
          </span>
          <span className="text-cyan">~</span>
          <span className="text-faint">$</span>
          <span className="sr-only"> Message input</span>
        </label>
        <div className="relative min-w-0 flex-1 rounded-sm ring-1 ring-transparent transition-shadow focus-within:ring-neon/20">
          <textarea
            id="terminal-input"
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setHistoryIndex(null);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={1}
            disabled={disabled}
            autoFocus
            spellCheck
            autoComplete="off"
            autoCapitalize="sentences"
            enterKeyHint="send"
            aria-describedby="terminal-input-hint"
            aria-invalid={over}
            placeholder={disabled ? disabledReason : ""}
            className="block w-full resize-none bg-transparent py-0.5 text-[13px] leading-relaxed text-ink caret-neon outline-none focus-visible:outline-none placeholder:text-faint disabled:cursor-not-allowed sm:text-sm"
          />
          {!value && focused && !disabled && (
            <span aria-hidden="true" className="cursor-block pointer-events-none absolute left-0 top-[3px]" />
          )}
        </div>
        <button
          type="submit"
          disabled={disabled || submitting || !value.trim() || over}
          aria-label="Send message"
          className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-neon/40 text-neon transition-colors hover:bg-neon/10 disabled:border-line disabled:text-faint"
        >
          <CornerDownLeft className="size-4" aria-hidden="true" />
        </button>
      </form>
      <div id="terminal-input-hint" className="mt-1.5 flex items-center justify-between gap-3 text-[10px] uppercase tracking-wider text-faint">
        <span className="hidden sm:inline">Enter send · Shift+Enter newline · ↑ history · /help</span>
        <span className="sm:hidden">/help for commands</span>
        <span className={over ? "text-danger" : near ? "text-amber" : ""} aria-live={near ? "polite" : "off"}>
          {count}/{maxLength}
        </span>
      </div>
    </div>
  );
});
