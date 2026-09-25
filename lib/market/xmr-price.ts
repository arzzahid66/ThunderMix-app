/*
 * Live XMR/USD quote. CoinMarketCap is the primary source; CoinGecko's public
 * API is the fallback when CMC is unavailable or out of quota. One in-memory
 * quote is shared by every visitor, so polling clients never multiply calls to
 * the upstream API (the CMC free plan allows ~10k calls per month).
 */

export interface XmrQuote {
  price_usd: number;
  change_24h: number;
  source: "coinmarketcap" | "coingecko";
  updated_at: string;
}

const CMC_MONERO_ID = "328";
const CMC_URL = `https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=${CMC_MONERO_ID}&convert=USD`;
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true";
const TIMEOUT_MS = 8_000;

function cacheMs(): number {
  const seconds = Number.parseInt(process.env.CMC_CACHE_SECONDS ?? "", 10);
  return (Number.isFinite(seconds) && seconds >= 5 ? seconds : 60) * 1000;
}

let cached: { quote: XmrQuote; fetchedAt: number } | null = null;
let inFlight: Promise<XmrQuote> | null = null;

function isValid(q: XmrQuote): boolean {
  return Number.isFinite(q.price_usd) && q.price_usd > 0 && Number.isFinite(q.change_24h);
}

async function fromCoinMarketCap(): Promise<XmrQuote> {
  const key = process.env.COINMARKETCAP_API_KEY;
  if (!key) throw new Error("COINMARKETCAP_API_KEY is not set");
  const res = await fetch(CMC_URL, {
    headers: { "X-CMC_PRO_API_KEY": key, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`CoinMarketCap HTTP ${res.status}`);
  const body = await res.json();
  const entry = body?.data?.[CMC_MONERO_ID];
  const usd = (Array.isArray(entry) ? entry[0] : entry)?.quote?.USD;
  const quote: XmrQuote = {
    price_usd: Number(usd?.price),
    change_24h: Number(usd?.percent_change_24h),
    source: "coinmarketcap",
    updated_at: usd?.last_updated ?? new Date().toISOString(),
  };
  if (!isValid(quote)) throw new Error("CoinMarketCap returned no XMR quote");
  return quote;
}

async function fromCoinGecko(): Promise<XmrQuote> {
  const res = await fetch(COINGECKO_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const m = (await res.json())?.monero;
  const quote: XmrQuote = {
    price_usd: Number(m?.usd),
    change_24h: Number(m?.usd_24h_change),
    source: "coingecko",
    updated_at: m?.last_updated_at ? new Date(m.last_updated_at * 1000).toISOString() : new Date().toISOString(),
  };
  if (!isValid(quote)) throw new Error("CoinGecko returned no XMR quote");
  return quote;
}

async function fetchQuote(): Promise<XmrQuote> {
  try {
    return await fromCoinMarketCap();
  } catch (error) {
    console.warn("[xmr-price] CoinMarketCap failed, using CoinGecko:", (error as Error).message);
    return fromCoinGecko();
  }
}

/**
 * The current quote, refreshed at most once per CMC_CACHE_SECONDS (default
 * 60). If every source fails, the last known quote is served; with none,
 * this throws.
 */
export async function getXmrQuote(): Promise<XmrQuote> {
  if (cached && Date.now() - cached.fetchedAt < cacheMs()) return cached.quote;
  if (!inFlight) {
    inFlight = fetchQuote()
      .then((quote) => {
        cached = { quote, fetchedAt: Date.now() };
        return quote;
      })
      .catch((error) => {
        if (cached) {
          console.error("[xmr-price] all sources failed, serving last quote:", (error as Error).message);
          return cached.quote;
        }
        throw error;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
