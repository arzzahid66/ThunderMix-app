"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiRequest } from "@/lib/api-client";
import { PRIVATE_KEY_LENGTH, privateKeySchema } from "@/lib/validation/schemas";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { VisitorSession } from "@/types";

const BOOT: { text: string; tone: "head" | "sys" | "ok" | "plain"; delay: number }[] = [
  { text: "[ SYSTEM INITIALIZATION ]", tone: "head", delay: 250 },
  { text: "[ SYSTEM ] Loading communication interface...", tone: "sys", delay: 420 },
  { text: "[ SYSTEM ] Establishing secure connection...", tone: "sys", delay: 520 },
  { text: "[ SYSTEM ] Connection interface ready.", tone: "ok", delay: 380 },
  { text: "", tone: "plain", delay: 120 },
  { text: "Welcome, visitor.", tone: "plain", delay: 360 },
  { text: "Enter your 64-character private key to continue.", tone: "plain", delay: 300 },
];

const toneClass = {
  head: "text-cyan glow-cyan tracking-[0.2em]",
  sys: "text-neon-dim",
  ok: "text-neon glow-neon",
  plain: "text-ink",
};

type Phase = "boot" | "resume" | "form" | "connecting" | "granted";

export function EntryTerminal({ existingName }: { existingName: string | null }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [shownRaw, setShown] = useState(0);
  const [phaseRaw, setPhase] = useState<Phase>("boot");
  const shown = reduced ? BOOT.length : shownRaw;
  const phase: Phase = reduced && phaseRaw === "boot" ? (existingName ? "resume" : "form") : phaseRaw;
  const [key, setKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [progress, setProgress] = useState<string[]>([]);
  const keyRef = useRef<HTMLInputElement>(null);

  // Boot sequence. With reduced motion it is skipped entirely (derived below).
  useEffect(() => {
    if (reduced) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      i += 1;
      setShown(i);
      if (i < BOOT.length) timer = setTimeout(next, BOOT[i].delay);
      else timer = setTimeout(() => setPhase(existingName ? "resume" : "form"), 250);
    };
    timer = setTimeout(next, BOOT[0].delay);
    return () => clearTimeout(timer);
  }, [reduced, existingName]);

  useEffect(() => {
    if (phase === "form") keyRef.current?.focus();
  }, [phase]);

  const skipBoot = () => {
    if (phase !== "boot") return;
    setShown(BOOT.length);
    setPhase(existingName ? "resume" : "form");
  };

  const submit = async () => {
    const parsed = privateKeySchema.safeParse(key);
    if (!parsed.success) {
      setErrors([parsed.error.issues[0]?.message ?? "Invalid private key."]);
      keyRef.current?.focus();
      return;
    }
    setErrors([]);

    setPhase("connecting");
    setProgress(["[ SYSTEM ] Verifying private key..."]);
    const res = await apiRequest<{ user: { name: string }; session: VisitorSession }>("/api/visitor/login", {
      method: "POST",
      body: { key: parsed.data },
    });
    if (!res.ok) {
      setPhase("form");
      setProgress([]);
      const retry = res.error.retryAfter ? ` Retry in ${res.error.retryAfter}s.` : "";
      setErrors([`${res.error.message}${retry}`]);
      keyRef.current?.focus();
      return;
    }
    const { session } = res.data;
    setKey("");
    setProgress((p) => [
      ...p,
      "[ SYSTEM ] Key accepted.",
      `[ SYSTEM ] Allocating session ${session.session_code}...`,
      "[ SYSTEM ] Access granted.",
    ]);
    setPhase("granted");
    setTimeout(() => router.push(`/terminal?s=${session.session_code}`), reduced ? 0 : 650);
  };

  const newIdentity = async () => {
    await apiRequest("/api/visitor/logout", { method: "POST", body: {} });
    setPhase("form");
  };

  const busy = phase === "connecting" || phase === "granted";

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-void px-4 py-10">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
      <div className="bg-vignette pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="scanlines" aria-hidden="true" />

      <div className="relative w-full max-w-2xl">
        <p className="mb-4 text-center text-[10px] uppercase tracking-[0.45em] text-faint" aria-hidden="true">
          tp://node-01 · public channel
        </p>

        <section className="terminal-frame overflow-hidden rounded-md" aria-labelledby="portal-title">
          <div className="flex items-center gap-2 border-b border-line bg-raised/70 px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-danger/80" aria-hidden="true" />
            <span className="size-2.5 rounded-full bg-amber/80" aria-hidden="true" />
            <span className="size-2.5 rounded-full bg-neon/80" aria-hidden="true" />
            <h1 id="portal-title" className="ml-3 text-[11px] uppercase tracking-[0.25em] text-muted">
              Terminal_Portal <span className="text-faint">— entry</span>
            </h1>
          </div>

          <div className="space-y-1 p-5 text-[13px] leading-relaxed sm:p-7 sm:text-sm" onClick={skipBoot}>
            <div aria-live="polite">
              {BOOT.slice(0, shown).map((line, i) => (
                <p key={i} className={`animate-reveal ${toneClass[line.tone]} ${line.text ? "" : "h-3"}`}>
                  {line.text}
                </p>
              ))}
              {phase === "boot" && <span className="cursor-block" aria-hidden="true" />}
            </div>

            {phase === "resume" && existingName && (
              <div className="animate-reveal space-y-4 pt-4">
                <p className="text-cyan">
                  [ SYSTEM ] Existing identity detected on this device: <span className="text-ink">{existingName}</span>
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="primary" onClick={() => router.push("/terminal")} autoFocus>
                    Resume session
                  </Button>
                  <Button variant="ghost" onClick={() => void newIdentity()}>
                    Use a different key
                  </Button>
                </div>
              </div>
            )}

            {(phase === "form" || busy) && (
              <form
                noValidate
                className="animate-reveal space-y-4 pt-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor="entry-key" className="text-neon">
                      ENTER PRIVATE KEY:
                    </label>
                    <span
                      className={`text-[11px] tabular-nums ${key.trim().length === PRIVATE_KEY_LENGTH ? "text-neon" : "text-faint"}`}
                      aria-live="polite"
                    >
                      {key.trim().length}/{PRIVATE_KEY_LENGTH}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      id="entry-key"
                      ref={keyRef}
                      type={reveal ? "text" : "password"}
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      maxLength={PRIVATE_KEY_LENGTH + 8}
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={busy}
                      aria-describedby="entry-key-hint"
                      className="h-10 min-w-0 flex-1 rounded-sm border border-line-strong bg-void/80 px-3 font-mono text-ink caret-neon outline-none transition-colors placeholder:text-faint focus:border-neon/70 focus:shadow-[0_0_0_3px_rgb(57_255_156/0.12)]"
                      placeholder="64 characters · 0-9 a-f"
                    />
                    <button
                      type="button"
                      onClick={() => setReveal((v) => !v)}
                      disabled={busy}
                      aria-label={reveal ? "Hide key" : "Show key"}
                      aria-pressed={reveal}
                      className="flex size-10 shrink-0 items-center justify-center rounded-sm border border-line-strong text-muted transition-colors hover:border-neon/50 hover:text-neon"
                    >
                      {reveal ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                    </button>
                  </div>
                  <p id="entry-key-hint" className="text-[11px] text-faint">
                    Your key is issued by the administrator.
                  </p>
                </div>

                {errors.length > 0 && (
                  <div role="alert" className="space-y-0.5 text-danger">
                    {errors.map((e) => (
                      <p key={e}>[ ERROR ] {e}</p>
                    ))}
                  </div>
                )}

                <div aria-live="polite" className="space-y-0.5">
                  {progress.map((p) => (
                    <p key={p} className={`animate-reveal ${p.includes("granted") ? "text-neon glow-neon" : "text-neon-dim"}`}>
                      {p}
                    </p>
                  ))}
                </div>

                <Button type="submit" variant="primary" className="w-full sm:w-auto" disabled={busy}>
                  {busy ? (
                    <>
                      <Spinner /> Connecting
                    </>
                  ) : (
                    "> Establish connection"
                  )}
                </Button>
              </form>
            )}
          </div>
        </section>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-faint">
          Secure channel · Responses may not be immediate · Never share your private key
        </p>
      </div>
    </main>
  );
}
