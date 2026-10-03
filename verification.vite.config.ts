import { mergeConfig } from 'vite';
import base from './frontend-shared/vite.config';
export default mergeConfig(base, { server: { proxy: { '/api/workflow': { target: 'http://127.0.0.1:8019', ws: true } } } });
