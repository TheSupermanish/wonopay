import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadOrder } from "@/lib/wono";

/** Serves the guide only for a paid order of that product. The server asks Wono; nothing from the browser counts. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await loadOrder(id);
  if (!order || order.product.unlock.kind !== "download") return new Response("Not found", { status: 404 });
  if (!order.paid) return new Response("Payment required", { status: 402 });
  const file = await readFile(path.join(process.cwd(), "content", "solana-payments-starter.md"));
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="solana-payments-starter.md"',
      "Cache-Control": "private, no-store",
    },
  });
}
