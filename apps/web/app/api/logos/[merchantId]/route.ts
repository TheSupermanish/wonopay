import { merchantLogo } from "@/lib/server/invoices.ts";

/** Public store logo, shown at checkout. Raster types only; the URL carries a version, so it caches. */
export async function GET(_request: Request, context: RouteContext<"/api/logos/[merchantId]">) {
  const { merchantId } = await context.params;
  const logo = await merchantLogo(merchantId);
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.type,
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
