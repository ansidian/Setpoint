import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;
const baseURL = "http://127.0.0.1:4173";
const authFile = "playwright/.auth/user.json";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.js/,
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: [/.*\.setup\.js/, /.*\.mobile\.spec\.js/],
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 960 },
        storageState: authFile,
      },
    },
    {
      name: "mobile-chromium",
      dependencies: ["setup"],
      testMatch: /.*\.mobile\.spec\.js/,
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        storageState: authFile,
      },
    },
  ],
  webServer: [
    {
      command: "npm run dev:server",
      url: "http://127.0.0.1:3001/api/auth/check",
      name: "api",
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "npm run dev:client -- --host 127.0.0.1 --port 4173 --strictPort",
      url: baseURL,
      name: "client",
      reuseExistingServer: !isCI,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
