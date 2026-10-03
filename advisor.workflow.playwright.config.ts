import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/workflow-browser', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5199', screenshot: 'only-on-failure' },
  webServer: [
    { command: `cd backend && RELAY_FIXTURE_DB=/tmp/relay-advisor-workflow-${process.pid}.sqlite3 PYTHONPATH=. .venv/bin/uvicorn browser_app:app --app-dir tests --host 127.0.0.1 --port 8029`, url: 'http://127.0.0.1:8029/api/workflow/session', reuseExistingServer: false },
    { command: 'RELAY_VITE_CACHE=/tmp/relay-advisor-workflow-vite npm run dev -- --config ../advisor.vite.config.ts --port 5199', url: 'http://127.0.0.1:5199', reuseExistingServer: false },
  ], reporter: 'list',
});
