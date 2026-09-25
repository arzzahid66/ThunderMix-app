"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ConnectionBadge } from "@/components/ui/status-badge";
import { Spinner } from "@/components/ui/spinner";
import { apiRequest } from "@/lib/api-client";
import { toHandle } from "@/lib/format";
import { clearTabSignedIn } from "@/lib/terminal/tab-auth";
import { useTerminalSession } from "@/hooks/use-terminal-session";
import { useXmrWallet } from "@/hooks/use-xmr-wallet";
import { TerminalInput, type TerminalInputHandle } from "./terminal-input";
import { TerminalOutput } from "./terminal-output";
import { WalletPanel } from "./wallet-panel";

const HELP = [
  "AVAILABLE COMMANDS",
  "  /help       show this help",
  "  /clear      clear the screen (history is kept)",
  "",
  "Anything else you type is transmitted as a message.",
  "Commands run only in your browser; nothing you type is executed on any system.",
];

export function TerminalApp() {
  const router = useRouter();
  const t = useTerminalSession();
  const wallet = useXmrWallet();
  const inputRef = useRef<TerminalInputHandle>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [exiting, setExiting] = useState(false);
  const handle = toHandle(t.profile?.name);

  const history = useMemo(() => {
    const failed = t.pending.filter((p) => p.status === "failed").map((p) => p.content);
    const sent = t.messages.filter((m) => m.sender_type === "user").map((m) => m.content);
    return [...sent.slice(-30), ...failed];
  }, [t.messages, t.pending]);

  // Blocked notice, once per conversation.
  const blocked = t.profile?.status === "blocked";
  const { activeId, addLocal } = t;
  useEffect(() => {
    if (blocked && activeId) addLocal(activeId, "error", "[ ERROR ] Access to this portal has been restricted.");
  }, [blocked, activeId, addLocal]);

  const onSubmit = useCallback(
    async (value: string) => {
      const sessionId = t.activeId;
      if (!sessionId) return false;
      const command = value.trim().toLowerCase();
      if (command === "/help") {
        t.addLocal(sessionId, "help", HELP);
        return true;
      }
      if (command === "/clear") {
        t.clearScreen(sessionId);
        return true;
      }
      return t.send(value);
    },
    [t],
  );

  const exit = async () => {
    setExiting(true);
    clearTabSignedIn();
    await apiRequest("/api/visitor/logout", { method: "POST", body: {} });
    router.replace("/");
    router.refresh();
  };

  const closedOrBlocked = t.activeSession?.status === "closed" || blocked;

  // ------------------------------------------------------------ fatal states
  if (t.fatal && t.fatal.code !== "user_blocked") {
    return (
      <FullScreenNotice
        lines={[`[ ERROR ] ${t.fatal.message}`, "[ SYSTEM ] Connection terminated."]}
        action={
          <Button
            variant="primary"
            onClick={() => {
              clearTabSignedIn();
              router.replace("/");
            }}
          >
            Enter key again
          </Button>
        }
      />
    );
  }

  if (!t.booted) {
    return <FullScreenNotice lines={["[ SYSTEM ] Restoring conversation…"]} spinner />;
  }

  return (
    <div className="flex h-dvh flex-col bg-void">
      <div className="scanlines" aria-hidden="true" />
      {/* Header */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel/90 px-3 py-2.5 backdrop-blur sm:px-5">
        <div className="flex items-center gap-2.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-danger/80" />
          <span className="size-2.5 rounded-full bg-amber/80" />
          <span className="size-2.5 rounded-full bg-neon/80" />
        </div>
        <h1 className="text-xs tracking-[0.18em] text-ink sm:text-[13px]">
          <span className="text-neon glow-neon">TERMINAL_PORTAL</span>
          <span className="hidden text-muted sm:inline">{" // ThunderMix"}</span>
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <ConnectionBadge status={t.status} compact />
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open wallet"
            aria-expanded={drawerOpen}
          >
            <Wallet className="size-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirmExit(true)} aria-label="Exit portal">
            <LogOut className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Exit</span>
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Desktop wallet */}
        <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-r border-line bg-panel/60 lg:flex">
          <WalletPanel {...wallet} />
        </aside>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Wallet">
            <button type="button" aria-label="Close wallet" className="absolute inset-0 bg-black/70" onClick={() => setDrawerOpen(false)} />
            <div className="absolute inset-y-0 left-0 flex w-[min(85vw,20rem)] flex-col overflow-y-auto border-r border-line bg-panel shadow-2xl animate-reveal">
              <WalletPanel {...wallet} onClose={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col bg-grid">
          {t.bootError && !t.activeSession ? (
            <div className="p-6 text-sm text-danger">
              <p>[ ERROR ] {t.bootError.message}</p>
              <p className="text-muted">[ SYSTEM ] Reload the page to try again.</p>
            </div>
          ) : (
            <TerminalOutput
              handle={handle}
              session={t.activeSession}
              messages={t.messages}
              local={t.local}
              pending={t.pending}
              clearedAt={t.clearedAt}
              liveIds={t.liveIds}
              confirmedIds={t.confirmedIds}
              loading={t.messagesLoading}
            />
          )}
          {t.activeSession?.status === "closed" && !blocked && (
            <div className="border-t border-amber/30 bg-amber/5 px-4 py-2 text-xs text-amber sm:px-6">
              [ SYSTEM ] This conversation has been closed.{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-ink disabled:opacity-60"
                onClick={() => void t.createSession()}
                disabled={t.creating}
              >
                Start a new conversation
              </button>{" "}
              to continue.
            </div>
          )}
          <TerminalInput
            ref={inputRef}
            handle={handle}
            maxLength={t.config.message_max_length}
            disabled={!t.activeSession || closedOrBlocked}
            disabledReason={blocked ? "Access restricted" : "Conversation closed — input disabled"}
            onSubmit={onSubmit}
            history={history}
          />
        </main>
      </div>

      <ConfirmDialog
        open={confirmExit}
        tone="danger"
        title="Exit portal"
        description={
          <>
            Exiting signs this browser out. Enter your private key again to continue where you left off.
          </>
        }
        confirmLabel="Exit"
        busy={exiting}
        onCancel={() => setConfirmExit(false)}
        onConfirm={() => void exit()}
      />
    </div>
  );
}

function FullScreenNotice({ lines, action, spinner }: { lines: string[]; action?: React.ReactNode; spinner?: boolean }) {
  return (
    <div className="flex h-dvh items-center justify-center bg-void bg-grid p-6">
      <div className="terminal-frame w-full max-w-lg rounded-md p-6 text-sm" role="status">
        {lines.map((l) => (
          <p key={l} className={l.startsWith("[ ERROR") ? "text-danger" : "text-neon-dim"}>
            {spinner && <Spinner className="mr-2" />}
            {l}
          </p>
        ))}
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}
