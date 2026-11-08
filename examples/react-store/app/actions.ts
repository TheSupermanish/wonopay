"use server";

import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { createPayLink } from "@wono/sdk";
import { PROFILE, PRODUCTS, priceFor, TIP } from "@/lib/profile";
import { WONO_URL } from "@/lib/wono";

/** Makes a keyless Wono payment link to PROFILE.wallet. No account, no API key. Returns the invoice id. */
export async function startOrder(id: string, requested?: string): Promise<string> {
  const product = id === TIP.id ? TIP : PRODUCTS.find((item) => item.id === id);
  if (!product) throw new Error("Unknown product.");
  // Prices come from lib/profile.ts, never from the client.
  const amount = priceFor(product, requested ?? "") ?? TIP.price;
  const invoice = await createPayLink(
    {
      to: PROFILE.wallet,
      amount,
      name: PROFILE.name,
      description: product === TIP ? `${product.title} · $${Number(amount)}` : product.title,
      reference: `${product.id}-${randomBytes(5).toString("hex")}`,
      expiresInHours: 24,
    },
    { baseUrl: WONO_URL },
  );
  return invoice.id;
}

/** No-JavaScript fallback: create the order, then open its page. */
export async function buy(form: FormData) {
  const id = await startOrder(String(form.get("product") ?? ""), String(form.get("amount") ?? ""));
  redirect(`/order/${id}`);
}
