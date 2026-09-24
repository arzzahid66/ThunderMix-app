"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-void bg-grid p-6">
      <div role="alert" className="terminal-frame w-full max-w-md rounded-md p-6 text-sm">
        <p className="text-danger">[ ERROR ] An unexpected error occurred.</p>
        <p className="text-muted">[ SYSTEM ] Please try again.{error.digest ? ` Ref: ${error.digest}` : ""}</p>
        <button type="button" onClick={reset} className="mt-5 text-neon underline-offset-4 hover:underline">
          &gt; retry
        </button>
      </div>
    </main>
  );
}
