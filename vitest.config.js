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
    include: ["server/**/*.test.js", "src/**/*.test.js", "src/**/*.test.jsx"],
    environment: "jsdom",
    testTimeout: 10000,
  },
});
