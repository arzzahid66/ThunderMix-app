"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiRequest } from "@/lib/api-client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await apiRequest("/api/admin/login", { method: "POST", body: { email, password } });
    if (!res.ok) {
      setBusy(false);
      setPassword("");
      const wait = res.error.retryAfter ? ` Try again in ${Math.ceil(res.error.retryAfter / 60)} min.` : "";
      setError(`${res.error.message}${wait}`);
      return;
    }
    router.replace(next);
    router.refresh();
  };

  const field =
    "h-10 w-full rounded-sm border border-line-strong bg-void px-3 text-sm text-ink caret-neon outline-none focus:border-neon/70 focus:shadow-[0_0_0_3px_rgb(57_255_156/0.12)]";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-void bg-grid px-4">
      <form onSubmit={submit} noValidate className="terminal-frame w-full max-w-sm space-y-5 rounded-md p-6" aria-labelledby="login-title">
        <div>
          <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-faint">
            <Lock className="size-3.5" aria-hidden="true" /> Restricted
          </p>
          <h1 id="login-title" className="mt-2 text-sm tracking-[0.18em] text-neon glow-neon">
            OPERATOR AUTHENTICATION
          </h1>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="admin-email" className="text-xs uppercase tracking-wider text-muted">
            Email
          </label>
          <input
            id="admin-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
            autoFocus
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="admin-password" className="text-xs uppercase tracking-wider text-muted">
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
            required
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            [ ERROR ] {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? (
            <>
              <Spinner /> Authenticating
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
    </main>
  );
}
