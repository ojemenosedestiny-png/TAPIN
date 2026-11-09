import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Load .env / .env.local (all keys, not only VITE_*) for the integration tests.
    env: loadEnv(mode, process.cwd(), ""),
    testTimeout: 30_000,
  },
}));
