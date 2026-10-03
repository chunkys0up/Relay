import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5198', screenshot: 'only-on-failure' },
  webServer: { command: 'RELAY_VITE_CACHE=/tmp/relay-advisor-demo-vite npm run dev -- --config ../advisor.vite.config.ts --port 5198', url: 'http://127.0.0.1:5198', reuseExistingServer: false },
  reporter: 'list',
});
