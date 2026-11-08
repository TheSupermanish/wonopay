import "server-only";
import { getInvoice, isPaidTo, toBaseUnits, Wono, WonoError, type Invoice } from "@wono/sdk";
import { PROFILE, priceFor, productFromReference, TIPS, type Product } from "./profile";

export const WONO_URL = process.env.WONO_URL ?? "http://127.0.0.1:3080";

export interface Order {
  invoice: Invoice;
  product: Product;
  price: string;
  paid: boolean;
}

/**
 * An order is a keyless Wono invoice this page would have made: it pays PROFILE.wallet the
 * product's own price. Anyone can create a link to a wallet, so all three are checked here,
 * on the server, against Wono's reconciled state. The checkout iframe never decides this.
 */
export async function loadOrder(id: string): Promise<Order | null> {
  const invoice = await getInvoice(id, { baseUrl: WONO_URL, refresh: true }).catch((error: unknown) => {
    if (error instanceof WonoError && error.status === 404) return null;
    throw error;
  });
  if (!invoice || invoice.recipient !== PROFILE.wallet) return null;
  const product = productFromReference(invoice.reference);
  const units = (price: string) => toBaseUnits(price, invoice.decimals);
  const price = product && priceFor(product, TIPS.find((tip) => units(tip) === invoice.amount));
  if (!product || !price || units(price) !== invoice.amount) return null;
  return { invoice, product, price, paid: isPaidTo(invoice, { to: PROFILE.wallet, amount: price }) };
}

/** Only the x402 example (/api/report) uses a Wono account key. The profile page needs none. */
let client: Wono | undefined;
export function wono(): Wono {
  client ??= new Wono({ apiKey: process.env.WONO_API_KEY ?? "", baseUrl: WONO_URL });
  return client;
}

export function usdc(units: string, decimals = 6): string {
  const value = BigInt(units);
  const scale = 10n ** BigInt(decimals);
  return `${value / scale}.${(value % scale).toString().padStart(decimals, "0").slice(0, 2)}`;
}
