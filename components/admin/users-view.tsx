"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserStatusBadge } from "@/components/ui/status-badge";
import { TimeText } from "@/components/ui/time-text";
import { useApi, useDebounced } from "@/hooks/use-api";
import { useQueryParams } from "@/hooks/use-query-params";
import type { AdminUserRow } from "@/types";
import { useAdminEvents } from "./admin-realtime";
import { CreateUserDialog } from "./key-dialogs";
import { EmptyState, ErrorNotice, inputCls, LoadingRow, PageHeader, Pagination, Panel, tdCls, thCls } from "./primitives";
import { SearchInput } from "./search-input";

interface UsersPage {
  rows: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function UsersView() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const { params, set, hrefWith } = useQueryParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const sort = params.get("sort") ?? "activity";
  const page = Number(params.get("page") ?? "1") || 1;

  const query = new URLSearchParams({ q, status, sort, page: String(page) });
  const users = useApi<UsersPage>(`/api/admin/users?${query}`);
  const refresh = useDebounced(() => void users.reload(), 800);
  useAdminEvents((e) => {
    if (e.type !== "message") refresh();
  });

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Each user signs in with a private key issued here. Search, sort and manage visitors."
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <UserPlus className="size-3.5" aria-hidden="true" /> Create user
          </Button>
        }
      />
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} onCreated={() => void users.reload()} />
      <div className="space-y-4 p-4 sm:p-8">
        <div className="flex flex-wrap items-end gap-3">
          <SearchInput
            id="user-search"
            label="Search name or key ending"
            value={q}
            placeholder="ada / a1f3"
            onCommit={(v) => set({ q: v })}
            className="w-full sm:w-72"
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="user-status" className="text-[10px] uppercase tracking-[0.18em] text-faint">
              Status
            </label>
            <select id="user-status" value={status} onChange={(e) => set({ status: e.target.value })} className={inputCls}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="user-sort" className="text-[10px] uppercase tracking-[0.18em] text-faint">
              Sort
            </label>
            <select id="user-sort" value={sort} onChange={(e) => set({ sort: e.target.value })} className={inputCls}>
              <option value="activity">Latest activity</option>
              <option value="newest">Newest created</option>
              <option value="name">Name A–Z</option>
            </select>
          </div>
        </div>

        <Panel>
          {users.error && <ErrorNotice message={users.error.message} onRetry={() => void users.reload()} />}
          {users.loading && !users.data && <LoadingRow label="Loading users" />}
          {users.data && users.data.rows.length === 0 && (
            <EmptyState title={q || status ? "No users match these filters." : "No users yet."} />
          )}
          {users.data && users.data.rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-[13px]">
                  <thead className="border-b border-line">
                    <tr>
                      <th scope="col" className={thCls}>Name</th>
                      <th scope="col" className={thCls}>Key</th>
                      <th scope="col" className={`${thCls} text-right`}>Sessions</th>
                      <th scope="col" className={`${thCls} text-right`}>Awaiting</th>
                      <th scope="col" className={thCls}>Last activity</th>
                      <th scope="col" className={thCls}>Created</th>
                      <th scope="col" className={thCls}>Status</th>
                      <th scope="col" className={thCls}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {users.data.rows.map((u) => (
                      <tr
                        key={u.id}
                        className="cursor-pointer transition-colors hover:bg-white/[0.02]"
                        onClick={() => router.push(`/admin/users/${u.id}`)}
                      >
                        <td className={`${tdCls} max-w-[14rem] truncate text-ink`}>{u.name}</td>
                        <td className={`${tdCls} font-mono text-muted`}>…{u.key_hint}</td>
                        <td className={`${tdCls} text-right tabular-nums`}>{u.session_count}</td>
                        <td className={`${tdCls} text-right tabular-nums ${u.unanswered_count ? "text-amber" : "text-faint"}`}>
                          {u.unanswered_count || "—"}
                        </td>
                        <td className={`${tdCls} text-muted`}><TimeText iso={u.last_seen_at} mode="relative" /></td>
                        <td className={`${tdCls} text-muted`}><TimeText iso={u.created_at} mode="date" /></td>
                        <td className={tdCls}><UserStatusBadge status={u.status} /></td>
                        <td className={`${tdCls} text-right`}>
                          <Link
                            href={`/admin/users/${u.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-[11px] uppercase tracking-wider text-cyan hover:underline"
                          >
                            View<span className="sr-only"> {u.name}</span>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={users.data.page}
                pageSize={users.data.pageSize}
                total={users.data.total}
                hrefFor={(p) => hrefWith({ page: String(p) })}
              />
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
