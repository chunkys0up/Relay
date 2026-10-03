import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/advisor-integration', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5201', screenshot: 'only-on-failure' },
  webServer: [
    { command: `cd backend && RELAY_FIXTURE_DB=/tmp/relay-advisor-integrated-${process.pid}.sqlite3 PYTHONPATH=.:tests .venv/bin/uvicorn advisor_browser_app:app --host 127.0.0.1 --port 8030`, url: 'http://127.0.0.1:8030/api/advisor/session', reuseExistingServer: false },
    { command: 'RELAY_WORKFLOW_PORT=8030 VITE_PACKET_DATA_MODE=fixture npm run dev -- --port 5201', url: 'http://127.0.0.1:5201', reuseExistingServer: false },
  ], reporter: 'list',
});
