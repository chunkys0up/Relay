import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({plugins:[react()], resolve:{alias:{'@relay/shared':fileURLToPath(new URL('./frontend-shared/src/index.ts',import.meta.url))}}, test:{environment:'jsdom',include:['**/*.test.ts','**/*.test.tsx'],setupFiles:['./tests/setup.ts']}});
