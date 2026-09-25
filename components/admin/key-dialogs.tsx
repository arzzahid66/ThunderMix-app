"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api-client";
import { nameSchema, NAME_MAX } from "@/lib/validation/schemas";
import type { AdminUserRow } from "@/types";

/** Opens/closes a native <dialog> with `open`. */
function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return ref;
}

const dialogCls =
  "m-auto w-[min(92vw,34rem)] rounded-sm border border-line-strong bg-panel p-0 text-ink backdrop:bg-black/75 backdrop:backdrop-blur-[2px]";

/** A private key shown once, with a copy button. */
function KeyReveal({ value, name }: { value: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Private key for <span className="text-ink">{name}</span>. Give it to the user; they enter it to sign in.
      </p>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 break-all rounded-sm border border-neon/40 bg-void px-3 py-2 font-mono text-[13px] leading-relaxed text-neon select-all">
          {value}
        </code>
        <Button variant="secondary" onClick={() => void copy()} aria-label="Copy key">
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
      <p role="note" className="text-xs text-amber">
        ⚠ This key will not be shown again. Only a hash is stored; if it is lost, regenerate it.
      </p>
    </div>
  );
}

/** Shows a freshly issued key once (after creation or regeneration). */
export function KeyDialog({
  open,
  title,
  name,
  keyValue,
  onClose,
}: {
  open: boolean;
  title: string;
  name: string;
  keyValue: string | null;
  onClose: () => void;
}) {
  const ref = useModal(open);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={dialogCls}
    >
      <div className="space-y-4 p-5">
        <h2 id={titleId} className="text-sm font-semibold uppercase tracking-widest text-neon">
          {title}
        </h2>
        {keyValue && <KeyReveal value={keyValue} name={name} />}
        <div className="flex justify-end pt-1">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** Asks for a name, creates the user and then shows their key once. */
export function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (user: AdminUserRow) => void;
}) {
  const ref = useModal(open);
  const titleId = useId();
  const inputId = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ key: string; name: string } | null>(null);

  const close = () => {
    if (busy) return;
    setName("");
    setError(null);
    setIssued(null);
    onClose();
  };

  const submit = async () => {
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid name.");
    setBusy(true);
    setError(null);
    const res = await apiRequest<{ user: AdminUserRow; key: string }>("/api/admin/users", {
      method: "POST",
      body: { name: parsed.data },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    setIssued({ key: res.data.key, name: res.data.user.name });
    onCreated(res.data.user);
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className={dialogCls}
    >
      {issued ? (
        <div className="space-y-4 p-5">
          <h2 id={titleId} className="text-sm font-semibold uppercase tracking-widest text-neon">
            User created
          </h2>
          <KeyReveal value={issued.key} name={issued.name} />
          <div className="flex justify-end pt-1">
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4 p-5"
        >
          <h2 id={titleId} className="text-sm font-semibold uppercase tracking-widest text-neon">
            Create user
          </h2>
          <p className="text-sm text-muted">
            A 64-character private key is generated for the user. It is shown once, right after creation.
          </p>
          <div className="space-y-1.5">
            <label htmlFor={inputId} className="block text-xs text-muted">
              Name
            </label>
            <input
              id={inputId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX + 20}
              autoComplete="off"
              autoFocus
              disabled={busy}
              className="h-10 w-full rounded-sm border border-line-strong bg-void px-3 text-sm text-ink outline-none focus:border-cyan"
              placeholder="e.g. Ada Lovelace"
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-danger">
              [ ERROR ] {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creating…" : "Create & issue key"}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
