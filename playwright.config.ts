import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',use:{baseURL:'http://127.0.0.1:5187',screenshot:'only-on-failure'},webServer:{command:'VITE_PACKET_DATA_MODE=fixture npm run dev -- --port 5187',url:'http://127.0.0.1:5187',reuseExistingServer:false},reporter:'list'});
