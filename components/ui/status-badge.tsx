import type { ConnectionStatus, SessionStatus, UserStatus } from "@/types";

type Tone = "neon" | "cyan" | "amber" | "danger" | "muted";

const tones: Record<Tone, string> = {
  neon: "border-neon/40 text-neon bg-neon/5",
  cyan: "border-cyan/40 text-cyan bg-cyan/5",
  amber: "border-amber/40 text-amber bg-amber/5",
  danger: "border-danger/40 text-danger bg-danger/5",
  muted: "border-line-strong text-muted bg-white/[0.02]",
};

/** Status is always conveyed by text (and a glyph), never by colour alone. */
export function Badge({ tone, glyph, children, className = "" }: {
  tone: Tone;
  glyph?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase leading-none tracking-wider ${tones[tone]} ${className}`}
    >
      {glyph && <span aria-hidden="true">{glyph}</span>}
      {children}
    </span>
  );
}

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  return status === "active" ? (
    <Badge tone="neon" glyph="●">Active</Badge>
  ) : (
    <Badge tone="muted" glyph="■">Closed</Badge>
  );
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return status === "active" ? (
    <Badge tone="neon" glyph="●">Active</Badge>
  ) : (
    <Badge tone="danger" glyph="⊘">Blocked</Badge>
  );
}

export function UnansweredBadge({ count }: { count: number }) {
  if (!count) return <span className="text-faint">—</span>;
  return (
    <Badge tone="amber" glyph="!">
      {count} awaiting
    </Badge>
  );
}

const connection: Record<ConnectionStatus, { tone: Tone; label: string; glyph: string }> = {
  connecting: { tone: "amber", label: "Connecting", glyph: "◌" },
  connected: { tone: "neon", label: "Connected", glyph: "●" },
  reconnecting: { tone: "amber", label: "Reconnecting", glyph: "◌" },
  offline: { tone: "danger", label: "Offline", glyph: "○" },
};

export function ConnectionBadge({ status, compact = false }: { status: ConnectionStatus; compact?: boolean }) {
  const c = connection[status];
  return (
    <span role="status" aria-live="polite" className="inline-flex">
      <Badge tone={c.tone} glyph={c.glyph} className={status === "connected" ? "" : "animate-pulse-soft"}>
        {compact ? c.label : `Status: ${c.label}`}
      </Badge>
    </span>
  );
}
