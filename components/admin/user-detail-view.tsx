"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, CheckCircle2, KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UserStatusBadge } from "@/components/ui/status-badge";
import { TimeText } from "@/components/ui/time-text";
import { apiRequest } from "@/lib/api-client";
import { useApi, useDebounced } from "@/hooks/use-api";
import type { AdminSessionRow, AdminUserRow } from "@/types";
import { useAdminEvents } from "./admin-realtime";
import { KeyDialog } from "./key-dialogs";
import { EmptyState, ErrorNotice, LoadingRow, PageHeader, Panel } from "./primitives";
import { SessionsTable } from "./sessions-table";

export function UserDetailView({ id }: { id: string }) {
  const router = useRouter();
  const detail = useApi<{ user: AdminUserRow; sessions: AdminSessionRow[] }>(`/api/admin/users/${id}`);
  const refresh = useDebounced(() => void detail.reload(), 700);
  useAdminEvents(() => refresh());

  const [dialog, setDialog] = useState<"block" | "delete" | "regenerate" | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const user = detail.data?.user;

  const setStatus = async (status: "active" | "blocked") => {
    setBusy(true);
    setActionError(null);
    const res = await apiRequest(`/api/admin/users/${id}`, { method: "PATCH", body: { status } });
    setBusy(false);
    if (!res.ok) return setActionError(res.error.message);
    setDialog(null);
    void detail.reload();
  };

  const regenerate = async () => {
    setBusy(true);
    setActionError(null);
    const res = await apiRequest<{ user: AdminUserRow; key: string }>(`/api/admin/users/${id}/key`, {
      method: "POST",
      body: {},
    });
    setBusy(false);
    if (!res.ok) return setActionError(res.error.message);
    setDialog(null);
    setNewKey(res.data.key);
    void detail.reload();
  };

  const remove = async () => {
    if (!user) return;
    setBusy(true);
    setActionError(null);
    const res = await apiRequest(`/api/admin/users/${id}`, { method: "DELETE", body: { confirmName: user.name } });
    setBusy(false);
    if (!res.ok) return setActionError(res.error.message);
    router.replace("/admin/users");
  };

  if (detail.error?.code === "not_found") {
    return (
      <>
        <PageHeader title="User not found" />
        <div className="p-8">
          <Link href="/admin/users" className="text-cyan hover:underline">← Back to users</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={user ? user.name : "User"}
        subtitle={
          <Link href="/admin/users" className="inline-flex items-center gap-1 hover:text-ink">
            <ArrowLeft className="size-3" aria-hidden="true" /> All users
          </Link>
        }
        actions={
          user && (
            <>
              {user.status === "active" ? (
                <Button variant="secondary" size="sm" onClick={() => setDialog("block")}>
                  <Ban className="size-3.5" aria-hidden="true" /> Block
                </Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => void setStatus("active")} disabled={busy}>
                  <CheckCircle2 className="size-3.5" aria-hidden="true" /> Unblock
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setDialog("regenerate")}>
                <KeyRound className="size-3.5" aria-hidden="true" /> Regenerate key
              </Button>
              <Button variant="danger" size="sm" onClick={() => setDialog("delete")}>
                <Trash2 className="size-3.5" aria-hidden="true" /> Delete
              </Button>
            </>
          )
        }
      />
      <div className="space-y-6 p-4 sm:p-8">
        {detail.error && <ErrorNotice message={detail.error.message} onRetry={() => void detail.reload()} />}
        {actionError && !dialog && <ErrorNotice message={actionError} />}
        {detail.loading && !user && <LoadingRow label="Loading user" />}

        {user && (
          <Panel title="Details">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 p-4 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Name", user.name],
                ["Private key", <span key="k" className="font-mono">…{user.key_hint}</span>],
                ["Status", <UserStatusBadge key="s" status={user.status} />],
                ["Created", <TimeText key="r" iso={user.created_at} mode="datetime" />],
                ["Last activity", <TimeText key="l" iso={user.last_seen_at} mode="datetime" />],
                ["Sessions", `${user.session_count} (${user.unanswered_count} unanswered messages)`],
              ].map(([k, v]) => (
                <div key={k as string} className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-[0.18em] text-faint">{k}</dt>
                  <dd className="mt-1 break-words text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-line px-4 py-3 text-[11px] text-faint">
              Only the last 4 characters of the key are stored in readable form. If the user lost their key, regenerate it;
              each browser only ever sees the sessions it created.
            </p>
          </Panel>
        )}

        {detail.data && (
          <Panel title={`Sessions (${detail.data.sessions.length})`}>
            {detail.data.sessions.length ? (
              <SessionsTable rows={detail.data.sessions} showUser={false} />
            ) : (
              <EmptyState title="This user has no sessions." />
            )}
          </Panel>
        )}
      </div>

      <ConfirmDialog
        open={dialog === "block"}
        title="Block user"
        description={
          <>
            <span className="text-ink">{user?.name}</span> will no longer be able to send messages or open sessions from
            any browser. Existing history is kept. You can unblock at any time.
          </>
        }
        confirmLabel="Block user"
        busy={busy}
        error={actionError}
        onCancel={() => {
          setDialog(null);
          setActionError(null);
        }}
        onConfirm={() => void setStatus("blocked")}
      />
      <ConfirmDialog
        open={dialog === "regenerate"}
        tone="primary"
        title="Regenerate private key"
        description={
          <>
            A new key is issued for <span className="text-ink">{user?.name}</span>. The current key stops working
            immediately and every browser signed in with it is signed out. History is kept.
          </>
        }
        confirmLabel="Regenerate key"
        busy={busy}
        error={actionError}
        onCancel={() => {
          setDialog(null);
          setActionError(null);
        }}
        onConfirm={() => void regenerate()}
      />
      <KeyDialog
        open={!!newKey}
        title="New private key"
        name={user?.name ?? ""}
        keyValue={newKey}
        onClose={() => setNewKey(null)}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        title="Delete user permanently"
        description={
          <>
            This permanently deletes the user, <span className="text-ink">all {user?.session_count} sessions</span>, every
            message and all browser access links. This cannot be undone.
          </>
        }
        confirmLabel="Delete forever"
        requireText={user?.name}
        busy={busy}
        error={actionError}
        onCancel={() => {
          setDialog(null);
          setActionError(null);
        }}
        onConfirm={() => void remove()}
      />
    </>
  );
}
