import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'src/playwright',
  timeout: 15_000,
  use: {
    baseURL: 'http://localhost:8787',
    browserName: 'chromium',
  },
  webServer: {
    command: 'node bench/serve.mjs',
    port: 8787,
    reuseExistingServer: true,
  },
});
