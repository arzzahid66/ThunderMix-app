"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, LogOut, Menu, MessagesSquare, Settings, Users, X } from "lucide-react";
import { ConnectionBadge } from "@/components/ui/status-badge";
import { apiRequest } from "@/lib/api-client";
import { useApi, useDebounced } from "@/hooks/use-api";
import type { AdminProfile } from "@/types";
import { AdminRealtimeProvider, useAdminEvents, useAdminRealtime } from "./admin-realtime";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/sessions", label: "Sessions", icon: MessagesSquare },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminShell({ profile, children }: { profile: AdminProfile; children: React.ReactNode }) {
  return (
    <AdminRealtimeProvider>
      <ShellInner profile={profile}>{children}</ShellInner>
    </AdminRealtimeProvider>
  );
}

function ShellInner({ profile, children }: { profile: AdminProfile; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useAdminRealtime();
  const [menuOpen, setMenuOpen] = useState(false);
  const awaiting = useApi<{ total: number }>("/api/admin/sessions?unanswered=1&pageSize=1");
  const refreshAwaiting = useDebounced(() => void awaiting.reload(), 600);
  useAdminEvents((e) => {
    if (e.type !== "user") refreshAwaiting();
  });

  const logout = async () => {
    await apiRequest("/api/admin/logout", { method: "POST", body: {} });
    router.replace("/admin/login");
    router.refresh();
  };

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));
  const awaitingCount = awaiting.data?.total ?? 0;

  const nav = (
    <nav aria-label="Admin" className="flex flex-1 flex-col gap-1 p-3">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? "page" : undefined}
          className={`flex items-center gap-3 rounded-sm px-3 py-2.5 text-[13px] transition-colors ${
            isActive(href) ? "bg-neon/[0.08] text-neon" : "text-muted hover:bg-white/[0.03] hover:text-ink"
          }`}
        >
          <Icon className="size-4" aria-hidden="true" />
          <span className="flex-1">{label}</span>
          {href === "/admin/sessions" && awaitingCount > 0 && (
            <span className="rounded-sm border border-amber/40 bg-amber/10 px-1.5 text-[10px] text-amber" title="Sessions awaiting reply">
              {awaitingCount}
              <span className="sr-only"> sessions awaiting reply</span>
            </span>
          )}
        </Link>
      ))}
    </nav>
  );

  const footer = (
    <div className="space-y-3 border-t border-line p-4">
      <ConnectionBadge status={status} compact />
      <div className="text-xs">
        <p className="truncate text-ink">{profile.display_name}</p>
        <p className="truncate text-faint">{profile.email}</p>
      </div>
      <button
        type="button"
        onClick={() => void logout()}
        className="flex w-full items-center gap-2 rounded-sm border border-line px-3 py-2 text-xs uppercase tracking-wider text-muted hover:border-danger/50 hover:text-danger"
      >
        <LogOut className="size-3.5" aria-hidden="true" /> Sign out
      </button>
    </div>
  );

  const brand = (
    <Link href="/admin" className="block px-5 py-4">
      <span className="text-[13px] tracking-[0.18em] text-neon glow-neon">TERMINAL_PORTAL</span>
      <span className="mt-0.5 block text-[10px] uppercase tracking-[0.3em] text-faint">Operator console</span>
    </Link>
  );

  return (
    <div className="min-h-dvh bg-void lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-panel lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-panel/95 px-4 py-3 backdrop-blur lg:hidden">
        <span className="text-xs tracking-[0.18em] text-neon">TERMINAL_PORTAL</span>
        <div className="flex items-center gap-2">
          <ConnectionBadge status={status} compact />
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open navigation"
            aria-expanded={menuOpen}
            className="rounded-sm border border-line p-1.5 text-muted"
          >
            <Menu className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/70" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-line bg-panel animate-reveal">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} className="p-1 text-muted">
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            {/* Following a link closes the drawer. */}
            <div className="flex flex-1 flex-col" onClick={() => setMenuOpen(false)}>
              {nav}
            </div>
            {footer}
          </div>
        </div>
      )}

      <div className="min-w-0">
        {children}
        <IncomingToasts />
      </div>
    </div>
  );
}

function IncomingToasts() {
  const { incoming, dismissIncoming } = useAdminRealtime();
  const pathname = usePathname();
  const visible = incoming.filter((m) => !pathname.endsWith(m.session_id));

  useEffect(() => {
    if (!incoming.length) return;
    const t = setTimeout(() => dismissIncoming(incoming[incoming.length - 1].id), 8_000);
    return () => clearTimeout(t);
  }, [incoming, dismissIncoming]);

  if (!visible.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[min(92vw,22rem)] flex-col gap-2" aria-live="polite">
      {visible.map((m) => (
        <div key={m.id} className="animate-reveal rounded-sm border border-cyan/40 bg-panel/95 p-3 text-xs shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <p className="uppercase tracking-wider text-cyan">◆ New visitor message</p>
            <button type="button" onClick={() => dismissIncoming(m.id)} aria-label="Dismiss notification" className="text-faint hover:text-ink">
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-1.5 line-clamp-2 text-ink/90">{m.content}</p>
          <Link
            href={`/admin/sessions/${m.session_id}`}
            onClick={() => dismissIncoming(m.id)}
            className="mt-2 inline-block text-neon underline-offset-2 hover:underline"
          >
            Open conversation →
          </Link>
        </div>
      ))}
    </div>
  );
}
