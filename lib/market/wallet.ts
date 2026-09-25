/** Every visitor's wallet holds this fixed USD value, shown in XMR at the live rate. */
export const WALLET_BALANCE_USD = 3_000_000;

/** How often the visitor's wallet asks for a fresh quote. */
export const WALLET_POLL_MS = 10_000;

/** XMR amount worth `usd` at `priceUsd` per XMR (Monero has 12 decimals). */
export function usdToXmr(usd: number, priceUsd: number): number {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return 0;
  return Math.round((usd / priceUsd) * 1e12) / 1e12;
}

export function formatXmr(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

export function formatUsd(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

/** "0.12%" — the sign is conveyed by the arrow and colour next to it. */
export function formatChange(percent: number): string {
  return `${Math.abs(percent).toFixed(2)}%`;
}
