import { getVisitorProfile } from "@/lib/auth/visitor";
import { jsonError, jsonOk } from "@/lib/http";
import { usdToXmr, WALLET_BALANCE_USD } from "@/lib/market/wallet";
import { getXmrQuote } from "@/lib/market/xmr-price";
import type { WalletQuote } from "@/types";

export const dynamic = "force-dynamic";

/** The signed-in visitor's wallet: the fixed USD balance valued at the live XMR rate. */
export async function GET() {
  try {
    const visitor = await getVisitorProfile();
    if (!visitor) return jsonError("no_access");
  } catch (error) {
    console.error("[wallet] identity check failed", error);
    return jsonError("server_error");
  }

  try {
    const quote = await getXmrQuote();
    const wallet: WalletQuote = {
      balance_usd: WALLET_BALANCE_USD,
      balance_xmr: usdToXmr(WALLET_BALANCE_USD, quote.price_usd),
      ...quote,
    };
    return jsonOk(wallet);
  } catch (error) {
    console.error("[wallet] price unavailable", error);
    return jsonError("price_unavailable");
  }
}
