import { test, expect } from '@playwright/test';

test('one Vite proxy reaches legacy, advisor, workflow HTTP and workflow WebSockets', async ({ page, request }) => {
  expect((await request.post('/api/chat', { data: {} })).status()).toBe(422);
  expect((await request.post('/api/documents/upload')).status()).toBe(422);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/advisor/documents');
  await expect(page.getByText('Connected · private history saved on server', { exact: true })).toBeVisible();
  const reply = await page.evaluate(async () => {
    const session = await fetch('/api/workflow/session');
    if (!session.ok) throw new Error('Workflow session failed');
    const { csrf_token: token } = await session.json() as { csrf_token: string };
    const created = await fetch('/api/workflow/cases', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token, 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ company: 'Unified test', goal: 'Check connection' }),
    });
    if (created.status !== 201) throw new Error('Workflow case failed');
    const state = await created.json() as { id: string; revision: number };
    return new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`${location.origin.replace('http', 'ws')}/api/workflow/cases/${state.id}/events`);
      const timeout = setTimeout(() => { socket.close(); reject(new Error('WebSocket timeout')); }, 5000);
      socket.onopen = () => socket.send(JSON.stringify({ csrf_token: token, after_revision: state.revision }));
      socket.onmessage = event => { clearTimeout(timeout); socket.close(); resolve(String(event.data)); };
      socket.onerror = () => { clearTimeout(timeout); socket.close(); reject(new Error('WebSocket connection failed')); };
    });
  });
  expect(JSON.parse(reply)).toEqual({ type: 'ready' });
  expect(errors).toEqual([]);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});
