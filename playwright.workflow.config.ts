import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/workflow-browser', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5189', screenshot: 'only-on-failure' },
  webServer: [
    { command: `cd backend && RELAY_FIXTURE_DB=/tmp/relay-browser-${process.pid}.sqlite3 PYTHONPATH=. .venv/bin/uvicorn browser_app:app --app-dir tests --host 127.0.0.1 --port 8001`, url: 'http://127.0.0.1:8001/api/workflow/session', reuseExistingServer: false },
    { command: 'npm run dev -- --port 5189', url: 'http://127.0.0.1:5189', reuseExistingServer: false },
  ], reporter: 'list',
});
