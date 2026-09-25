"use client";

import { useEffect, useState } from "react";
import { ChevronDown, RefreshCw, Wallet, X } from "lucide-react";
import { formatChange, formatUsd, formatXmr, WALLET_BALANCE_USD } from "@/lib/market/wallet";
import type { useXmrWallet } from "@/hooks/use-xmr-wallet";

type WalletState = ReturnType<typeof useXmrWallet>;

const SOURCE_LABEL = { coinmarketcap: "CoinMarketCap", coingecko: "CoinGecko" } as const;

/** Seconds since `since`, re-rendered every second. */
function useSecondsAgo(since: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return since === null ? null : Math.max(0, Math.round((now - since) / 1000));
}

export function WalletPanel({
  wallet,
  error,
  loading,
  checkedAt,
  refresh,
  onClose,
}: WalletState & { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const ago = useSecondsAgo(checkedAt);
  const up = (wallet?.change_24h ?? 0) >= 0;

  return (
    <section aria-label="Wallet" className="border-b border-line">
      <div className="flex items-center px-4 pt-3">
        <h2 className="mr-auto flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-muted">
          <Wallet className="size-3.5" aria-hidden="true" /> Wallet
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh live rate"
          title="Refresh live rate"
          className="rounded-sm p-1 text-muted transition-colors hover:text-neon disabled:opacity-60"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close wallet" className="ml-1 rounded-sm p-1 text-muted hover:text-ink">
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="space-y-2.5 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="wallet-balance"
          className="flex w-full items-center justify-between rounded-sm border border-line-strong bg-void/60 px-3 py-2 text-left text-sm text-ink transition-colors hover:border-neon/50"
        >
          <span className="text-neon">Balance</span>
          <ChevronDown className={`size-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>

        {open && (
          <div id="wallet-balance" className="animate-reveal rounded-sm border border-neon/30 bg-neon/[0.04] px-3 py-2.5" aria-live="polite">
            <p className="break-all text-lg leading-tight text-neon glow-neon">
              {wallet ? formatXmr(wallet.balance_xmr) : "—"} <span className="text-xs text-neon-dim">XMR</span>
            </p>
            <p className="mt-1 text-xs text-muted">
              ≈ <span className="text-ink">{formatUsd(WALLET_BALANCE_USD)}</span> USD
            </p>
          </div>
        )}

        <div className="px-1 text-xs">
          <p className="text-[10px] uppercase tracking-wider text-faint">XMR / USD · live</p>
          {wallet ? (
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className="text-base text-ink">{formatUsd(wallet.price_usd)}</span>
              <span className={up ? "text-neon" : "text-danger"}>
                <span aria-hidden="true">{up ? "▲" : "▼"}</span>
                <span className="sr-only">{up ? "up" : "down"}</span> {formatChange(wallet.change_24h)} (24h)
              </span>
            </p>
          ) : (
            <p className="mt-0.5 text-muted">{error ? "Rate unavailable" : "Loading…"}</p>
          )}
          {error && wallet && <p className="mt-0.5 text-amber">Showing last known rate.</p>}
          {ago !== null && wallet && (
            <p className="mt-0.5 text-[10px] text-faint">
              updated {ago}s ago · {SOURCE_LABEL[wallet.source]}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
