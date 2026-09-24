"use client";

import { Button } from "@/components/ui/button";
import { useApi, useDebounced } from "@/hooks/use-api";
import { useQueryParams } from "@/hooks/use-query-params";
import type { AdminSessionRow } from "@/types";
import { useAdminEvents } from "./admin-realtime";
import { EmptyState, ErrorNotice, inputCls, LoadingRow, PageHeader, Pagination, Panel } from "./primitives";
import { SearchInput } from "./search-input";
import { SessionsTable } from "./sessions-table";

interface SessionsPage {
  rows: AdminSessionRow[];
  total: number;
  page: number;
  pageSize: number;
}

const FILTER_KEYS = ["email", "code", "status", "unanswered", "from", "to", "sort"] as const;

export function SessionsView() {
  const { params, set, hrefWith } = useQueryParams();
  const get = (k: string) => params.get(k) ?? "";
  const page = Number(get("page") || "1") || 1;

  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) if (get(key)) query.set(key, get(key));
  query.set("page", String(page));

  const sessions = useApi<SessionsPage>(`/api/admin/sessions?${query}`);
  const refresh = useDebounced(() => void sessions.reload(), 700);
  useAdminEvents((e) => {
    if (e.type !== "user") refresh();
  });

  const hasFilters = FILTER_KEYS.some((k) => get(k));
  const label = "text-[10px] uppercase tracking-[0.18em] text-faint";

  return (
    <>
      <PageHeader title="Sessions" subtitle="All terminal sessions. Filtering and pagination run on the server." />
      <div className="space-y-4 p-4 sm:p-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 xl:items-end">
          <SearchInput id="f-email" label="User email" value={get("email")} placeholder="@example.com" onCommit={(v) => set({ email: v })} className="xl:col-span-2" />
          <SearchInput id="f-code" label="Session code" value={get("code")} placeholder="SESS_…" onCommit={(v) => set({ code: v })} />
          <div className="flex flex-col gap-1">
            <label htmlFor="f-status" className={label}>Status</label>
            <select id="f-status" value={get("status")} onChange={(e) => set({ status: e.target.value })} className={inputCls}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="f-from" className={label}>Created from</label>
            <input id="f-from" type="date" value={get("from")} onChange={(e) => set({ from: e.target.value })} className={`${inputCls} [color-scheme:dark]`} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="f-to" className={label}>Created to</label>
            <input id="f-to" type="date" value={get("to")} onChange={(e) => set({ to: e.target.value })} className={`${inputCls} [color-scheme:dark]`} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="f-sort" className={label}>Sort</label>
            <select id="f-sort" value={get("sort") || "activity"} onChange={(e) => set({ sort: e.target.value === "activity" ? "" : e.target.value })} className={inputCls}>
              <option value="activity">Last activity</option>
              <option value="queue">Awaiting reply first</option>
              <option value="created">Newest created</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={!!get("unanswered")}
              onChange={(e) => set({ unanswered: e.target.checked ? "1" : null })}
              className="size-4 accent-[var(--color-amber)]"
            />
            Only sessions with unanswered messages
          </label>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))}
            >
              Clear filters
            </Button>
          )}
        </div>

        <Panel>
          {sessions.error && <ErrorNotice message={sessions.error.message} onRetry={() => void sessions.reload()} />}
          {sessions.loading && !sessions.data && <LoadingRow label="Loading sessions" />}
          {sessions.data && sessions.data.rows.length === 0 && (
            <EmptyState title={hasFilters ? "No sessions match these filters." : "No sessions yet."} />
          )}
          {sessions.data && sessions.data.rows.length > 0 && (
            <>
              <SessionsTable rows={sessions.data.rows} />
              <Pagination
                page={sessions.data.page}
                pageSize={sessions.data.pageSize}
                total={sessions.data.total}
                hrefFor={(p) => hrefWith({ page: String(p) })}
              />
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
