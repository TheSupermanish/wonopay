import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // Docker images use the standalone server (deploy/Dockerfile sets NEXT_OUTPUT).
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  serverExternalPackages: ["@solana/web3.js", "@solana/spl-token"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
