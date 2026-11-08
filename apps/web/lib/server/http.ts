import "server-only";
import { WonoError } from "@wono/sdk";
import { ConfigurationError } from "./config.ts";
import { UserError } from "./invoices.ts";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Map known errors to safe responses; never leak internals or credentials. */
export async function handle(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof UserError) return json({ error: error.message }, error.status);
    if (error instanceof ConfigurationError) return json({ error: error.message, configuration: true }, 503);
    if (error instanceof WonoError) {
      const status = error.code === "HTTP_ERROR" && error.status && error.status < 500 ? 422 : 502;
      return json({ error: error.providerMessage ? `Aurora: ${error.providerMessage}` : error.message, code: error.code }, status);
    }
    console.error("[wono] unhandled", error instanceof Error ? error.message : error);
    return json({ error: "Something went wrong. No funds were moved by this request." }, 500);
  }
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new UserError("Expected a JSON object.");
}
