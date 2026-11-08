import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // Docker images use the standalone server (deploy/Dockerfile sets NEXT_OUTPUT).
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
};

export default config;
