import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 1,
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
