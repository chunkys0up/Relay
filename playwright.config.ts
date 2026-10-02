import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',use:{baseURL:'http://127.0.0.1:5178',screenshot:'only-on-failure'},webServer:{command:'npm run dev -- --port 5178',url:'http://127.0.0.1:5178',reuseExistingServer:false},reporter:'list'});
