import "server-only";
import { headers } from "next/headers";
import { configuredPublicOrigin } from "./config.ts";

/** Origin used in checkout links and embed snippets. Prefer WONO_PUBLIC_URL in production. */
export async function publicOrigin(): Promise<string> {
  const configured = configuredPublicOrigin();
  if (configured) return configured;
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "127.0.0.1:3080";
  const proto = list.get("x-forwarded-proto") ?? (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
