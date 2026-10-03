import { defineConfig } from '@playwright/test';
import baseline from './playwright.workflow.config';
export default defineConfig({ ...baseline,
 outputDir: 'verification-evidence/workflow-browser',
 webServer: [
 { command: 'cd backend && RELAY_FIXTURE_DB=/tmp/relay-verify-20261002.sqlite3 PYTHONPATH=. .venv/bin/uvicorn browser_app:app --app-dir tests --host 127.0.0.1 --port 8019', url: 'http://127.0.0.1:8019/api/workflow/session', reuseExistingServer: false },
 { command: 'npm run dev -- --port 5189 --config ../verification.vite.config.ts', url: 'http://127.0.0.1:5189', reuseExistingServer: false }
 ]
});
