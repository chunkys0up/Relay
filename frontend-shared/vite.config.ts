import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig({
  plugins: [react()],
  // amazon-chime-sdk-js references Node's `global`; map it to the browser global.
  define: { global: 'globalThis' },
  optimizeDeps: { esbuildOptions: { define: { global: 'globalThis' } } },
  resolve: { alias: { '@relay/shared': fileURLToPath(new URL('./src/index.ts', import.meta.url)) } },
  server: {
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.RELAY_BACKEND_PORT ?? process.env.RELAY_WORKFLOW_PORT ?? '8000'}`, ws: true } },
    fs: { allow: [repositoryRoot] },
  },
  test: { root: repositoryRoot, environment: 'jsdom', include: ['**/*.test.ts', '**/*.test.tsx'], setupFiles: ['./tests/setup.ts'] },
});
