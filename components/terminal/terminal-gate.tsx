"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { isTabSignedIn } from "@/lib/terminal/tab-auth";
import { TerminalApp } from "./terminal-app";

const noop = () => () => {};

/**
 * Shows the terminal only in a tab where the key was entered. A new tab (or a
 * reopened one) goes back to the entry screen. This browser's other tabs are
 * left signed in, so the server session is not revoked here.
 */
export function TerminalGate() {
  const router = useRouter();
  const signedIn = useSyncExternalStore(noop, isTabSignedIn, () => null);

  useEffect(() => {
    if (signedIn === false) router.replace("/");
  }, [signedIn, router]);

  if (!signedIn) {
    return (
      <div className="flex h-dvh items-center justify-center bg-void bg-grid p-6 text-sm text-neon-dim" role="status">
        <Spinner className="mr-2" /> [ SYSTEM ] Verifying access…
      </div>
    );
  }
  return <TerminalApp />;
}
