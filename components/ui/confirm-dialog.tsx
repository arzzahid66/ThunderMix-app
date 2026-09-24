"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./button";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  /** When set, the user must type this exact text to enable the confirm button. */
  requireText?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Accessible modal built on <dialog> (focus trap, Esc to close). */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = "danger",
  requireText,
  busy,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const titleId = useId();
  const inputId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setTyped("");
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const matches = !requireText || typed.trim().toLowerCase() === requireText.toLowerCase();

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-[min(92vw,30rem)] rounded-sm border border-line-strong bg-panel p-0 text-ink backdrop:bg-black/75 backdrop:backdrop-blur-[2px]"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (matches && !busy) onConfirm();
        }}
        className="space-y-4 p-5"
      >
        <h2 id={titleId} className={`text-sm font-semibold uppercase tracking-widest ${tone === "danger" ? "text-danger" : "text-neon"}`}>
          {tone === "danger" ? "⚠ " : ""}
          {title}
        </h2>
        <div className="text-sm leading-relaxed text-muted">{description}</div>
        {requireText && (
          <div className="space-y-1.5">
            <label htmlFor={inputId} className="block text-xs text-muted">
              Type <span className="text-ink">{requireText}</span> to confirm
            </label>
            <input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full rounded-sm border border-line-strong bg-void px-3 text-sm text-ink outline-none focus:border-cyan"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger">
            [ ERROR ] {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant={tone === "danger" ? "danger" : "primary"} disabled={!matches || busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
