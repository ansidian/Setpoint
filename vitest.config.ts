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
    server: {
      deps: {
        // node-cron 4.2.1 publishes an ESM sourcemap that references an omitted
        // source file. Native Node loading avoids feeding that broken map into
        // Vitest's transform pipeline while preserving app-source sourcemaps.
        external: ["node-cron"],
      },
    },
    // Running all four projects at the host's full 16-worker parallelism starves
    // happy-dom timers and animation frames under the complete suite. A bounded
    // shared pool keeps DOM polling deterministic without serializing test files.
    maxWorkers: 4,
    testTimeout: 10000,
    setupFiles: ["./scripts/vitest-guardrails.ts"],
    dangerouslyIgnoreUnhandledErrors: false,
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
