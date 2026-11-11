import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  cacheComponents: true,
  poweredByHeader: false, // don't advertise the framework
  async headers() {
    return [
      // Every page and file: browser-side protections (see lib/security-headers.ts).
      { source: "/:path*", headers: securityHeaders({ supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, dev: process.env.NODE_ENV !== "production" }) },
      // The kiosk's service worker must always be re-checked, so updates reach the gate.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] },
    ];
  },
  experimental: {
    // Excel imports are up to 5 MB (checked again in the action).
    serverActions: { bodySizeLimit: "6mb" },
    // Dashboard pages always wait on the logged-in user's session, so they can't be instant.
    // Validate only the pages that opt in (kiosk, login) — see `export const instant`.
    instantInsights: { validationLevel: "manual-warning" },
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
