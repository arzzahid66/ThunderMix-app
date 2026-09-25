"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { SessionStatusBadge, UnansweredBadge } from "@/components/ui/status-badge";
import { TimeText } from "@/components/ui/time-text";
import type { AdminSessionRow } from "@/types";
import { tdCls, thCls } from "./primitives";

export function SessionsTable({ rows, showUser = true }: { rows: AdminSessionRow[]; showUser?: boolean }) {
  const router = useRouter();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-[13px]">
        <thead className="border-b border-line">
          <tr>
            <th scope="col" className={thCls}>Session</th>
            {showUser && <th scope="col" className={thCls}>User</th>}
            {showUser && <th scope="col" className={thCls}>Key</th>}
            <th scope="col" className={thCls}>Created</th>
            <th scope="col" className={thCls}>Last activity</th>
            <th scope="col" className={`${thCls} text-right`}>Msgs</th>
            <th scope="col" className={thCls}>Status</th>
            <th scope="col" className={thCls}>Unanswered</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((s) => (
            <tr
              key={s.id}
              onClick={() => router.push(`/admin/sessions/${s.id}`)}
              className={`cursor-pointer transition-colors hover:bg-white/[0.02] ${s.unanswered_count ? "bg-amber/[0.025]" : ""}`}
            >
              <td className={tdCls}>
                <Link
                  href={`/admin/sessions/${s.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-cyan hover:underline"
                >
                  {s.session_code}
                </Link>
                {s.visitor_hidden_at && (
                  <span className="ml-2 text-[10px] uppercase text-faint" title="The visitor deleted this session from their history">
                    ⌫ deleted
                  </span>
                )}
              </td>
              {showUser && (
                <td className={`${tdCls} max-w-[12rem] truncate text-ink`}>
                  {s.user_name}
                  {s.user_status === "blocked" && <span className="ml-2 text-[10px] uppercase text-danger">⊘ blocked</span>}
                </td>
              )}
              {showUser && <td className={`${tdCls} font-mono text-muted`}>…{s.user_key_hint}</td>}
              <td className={`${tdCls} text-muted`}><TimeText iso={s.created_at} mode="datetime" /></td>
              <td className={`${tdCls} text-muted`}><TimeText iso={s.last_activity_at} mode="relative" /></td>
              <td className={`${tdCls} text-right tabular-nums`}>{s.message_count}</td>
              <td className={tdCls}><SessionStatusBadge status={s.status} /></td>
              <td className={tdCls}><UnansweredBadge count={s.unanswered_count} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
