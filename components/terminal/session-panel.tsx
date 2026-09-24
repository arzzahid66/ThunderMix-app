"use client";

import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionStatusBadge } from "@/components/ui/status-badge";
import { TimeText } from "@/components/ui/time-text";
import { pluralize } from "@/lib/format";
import type { VisitorSession } from "@/types";

interface Props {
  sessions: VisitorSession[];
  activeId: string | null;
  unread: Record<string, boolean>;
  creating: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (session: VisitorSession) => void;
  onClose?: () => void;
  canCreate: boolean;
}

export function SessionPanel({ sessions, activeId, unread, creating, onSelect, onCreate, onDelete, onClose, canCreate }: Props) {
  return (
    <nav aria-label="Session history" className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted">
          Sessions <span className="text-faint">[{sessions.length}]</span>
        </h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close session list" className="rounded-sm p-1 text-muted hover:text-ink">
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="p-3">
        <Button variant="primary" size="sm" className="w-full" onClick={onCreate} disabled={creating || !canCreate}>
          <Plus className="size-3.5" aria-hidden="true" /> {creating ? "Opening…" : "New session"}
        </Button>
      </div>

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {sessions.length === 0 && <li className="px-2 py-6 text-center text-xs text-faint">No sessions yet.</li>}
        {sessions.map((s) => {
          const active = s.id === activeId;
          return (
            <li key={s.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={active ? "true" : undefined}
                className={`w-full rounded-sm border px-3 py-2.5 text-left transition-colors ${
                  active ? "border-neon/40 bg-neon/[0.06]" : "border-transparent hover:border-line hover:bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm ${active ? "text-neon" : "text-ink"}`}>
                    {active && <span aria-hidden="true">▸ </span>}
                    {s.session_code}
                  </span>
                  <SessionStatusBadge status={s.status} />
                </div>
                {/* pr-8 keeps these rows clear of the delete button in the corner. */}
                <div className="mt-1.5 space-y-0.5 pr-8 text-[10px] uppercase tracking-wider text-faint">
                  <p>
                    Opened <TimeText iso={s.created_at} mode="date" /> · {pluralize(s.message_count, "msg")}
                  </p>
                  <p>
                    Last activity <TimeText iso={s.last_activity_at} mode="relative" />
                  </p>
                </div>
                {unread[s.id] && (
                  <span className="mt-1.5 inline-block text-[10px] uppercase tracking-wider text-cyan">◆ New transmission</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => onDelete(s)}
                aria-label={`Delete session ${s.session_code}`}
                title="Delete session"
                className="absolute bottom-1.5 right-1.5 flex size-7 items-center justify-center rounded-sm text-faint transition-colors hover:bg-danger/10 hover:text-danger focus-visible:text-danger sm:opacity-60 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
