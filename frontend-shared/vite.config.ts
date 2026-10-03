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
  server: { fs: { allow: [repositoryRoot] } },
  test: { root: repositoryRoot, environment: 'jsdom', include: ['**/*.test.ts', '**/*.test.tsx'], setupFiles: ['./tests/setup.ts'] },
});
