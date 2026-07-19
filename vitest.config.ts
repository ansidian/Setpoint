import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";
import { testEnvironmentPartitions } from "./scripts/lib/test-environment-partitions.mts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    testTimeout: 10000,
    projects: testEnvironmentPartitions.map(({ name, environment, include, exclude }) => ({
      extends: true,
      test: {
        name,
        environment,
        include,
        exclude,
      },
    })),
  },
});
