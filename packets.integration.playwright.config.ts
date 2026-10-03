import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/packets-integration',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5207', screenshot: 'only-on-failure' },
  webServer: [
    {
      command: 'cd backend && PYTHON_DOTENV_DISABLED=1 RELAY_WORKFLOW_DB=/tmp/relay-packets-check-' + process.pid + '.sqlite3 AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_ACCESS_KEY_ID=offline-test AWS_SECRET_ACCESS_KEY=offline-test AWS_EC2_METADATA_DISABLED=true PYTHONPATH=. .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8037',
      url: 'http://127.0.0.1:8037/api/workflow/session',
      reuseExistingServer: false,
    },
    {
      command: 'RELAY_BACKEND_PORT=8037 npm run dev -- --port 5207',
      url: 'http://127.0.0.1:5207',
      reuseExistingServer: false,
    },
  ],
  reporter: 'list',
});
