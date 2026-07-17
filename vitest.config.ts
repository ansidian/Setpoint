import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: [
      "server/**/*.test.ts",
      "src/**/*.test.{ts,tsx}",
      "scripts/**/*.test.mts",
    ],
    environment: "happy-dom",
    testTimeout: 10000,
  },
});
