"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, MessageSquareText, Radio, Users, UserX } from "lucide-react";
import { TimeText } from "@/components/ui/time-text";
import { useApi, useDebounced } from "@/hooks/use-api";
import type { AdminStats } from "@/types";
import { useAdminEvents } from "./admin-realtime";
import { EmptyState, ErrorNotice, LoadingRow, PageHeader, Panel } from "./primitives";

export function OverviewView() {
  const [tz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const stats = useApi<AdminStats>(`/api/admin/stats?tz=${encodeURIComponent(tz)}`);
  const refresh = useDebounced(() => void stats.reload(), 700);
  useAdminEvents(() => refresh());

  const s = stats.data;
  const cards = s
    ? [
        { label: "Total users", value: s.total_users, icon: Users, tone: "text-ink", href: "/admin/users" },
        { label: "Total sessions", value: s.total_sessions, icon: MessageSquareText, tone: "text-ink", href: "/admin/sessions" },
        { label: "Active sessions", value: s.active_sessions, icon: Radio, tone: "text-neon", href: "/admin/sessions?status=active" },
        {
          label: "Unanswered messages",
          value: s.unanswered_messages,
          icon: AlertTriangle,
          tone: s.unanswered_messages ? "text-amber" : "text-ink",
          href: "/admin/sessions?unanswered=1",
          sub: `${s.awaiting_sessions} session${s.awaiting_sessions === 1 ? "" : "s"} awaiting reply`,
        },
        { label: "Messages today", value: s.messages_today, icon: Activity, tone: "text-cyan", sub: `Visitor messages since midnight (${tz})` },
        { label: "Blocked users", value: s.blocked_users, icon: UserX, tone: s.blocked_users ? "text-danger" : "text-ink", href: "/admin/users?status=blocked" },
      ]
    : [];

  return (
    <>
      <PageHeader title="Overview" subtitle="Live figures computed from the database." />
      <div className="space-y-6 p-4 sm:p-8">
        {stats.error && <ErrorNotice message={stats.error.message} onRetry={() => void stats.reload()} />}
        {stats.loading && !s && <LoadingRow label="Loading statistics" />}

        {s && (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map(({ label, value, icon: Icon, tone, href, sub }) => {
              const body = (
                <div className="h-full rounded-sm border border-line bg-panel p-4 transition-colors hover:border-line-strong">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-muted">
                    {label}
                    <Icon className="size-4 text-faint" aria-hidden="true" />
                  </div>
                  <p className={`mt-3 text-3xl tabular-nums ${tone}`}>{value.toLocaleString()}</p>
                  {sub && <p className="mt-1 text-[11px] text-faint">{sub}</p>}
                </div>
              );
              return <li key={label}>{href ? <Link href={href} className="block h-full">{body}</Link> : body}</li>;
            })}
          </ul>
        )}

        {s && (
          <Panel title="Recent activity">
            {s.recent_activity.length === 0 ? (
              <EmptyState title="No messages yet." hint="Visitor messages will appear here in real time." />
            ) : (
              <ul className="divide-y divide-line">
                {s.recent_activity.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/admin/sessions/${a.session_id}`}
                      className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-white/[0.02] sm:flex-row sm:items-center sm:gap-4"
                    >
                      <span
                        className={`w-20 shrink-0 text-[11px] uppercase tracking-wider ${
                          a.sender_type === "user" ? "text-neon" : a.sender_type === "admin" ? "text-cyan" : "text-amber"
                        }`}
                      >
                        [{a.sender_type === "user" ? "USER" : a.sender_type === "admin" ? "ADMIN" : "SYSTEM"}]
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink/90">{a.preview}</span>
                      <span className="shrink-0 text-[11px] text-muted">
                        {a.session_code} · {a.user_name} · <TimeText iso={a.created_at} mode="relative" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}
