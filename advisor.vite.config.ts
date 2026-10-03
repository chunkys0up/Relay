import { defineConfig, mergeConfig } from 'vitest/config';
import base from './frontend-shared/vite.config';
export default mergeConfig(base, defineConfig({
  cacheDir: process.env.RELAY_VITE_CACHE ?? '/tmp/relay-advisor-vite-cache',
  server: { proxy: {
    '/api/workflow': { target: process.env.RELAY_BACKEND_ORIGIN ?? 'http://127.0.0.1:8029', ws: true },
    '/api/advisor': { target: process.env.RELAY_BACKEND_ORIGIN ?? 'http://127.0.0.1:8029', ws: true },
  } },
}));
