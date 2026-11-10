import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
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
