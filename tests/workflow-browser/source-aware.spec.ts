import { test, expect, type Page } from '@playwright/test';
import type { WorkflowCase } from '../../client-frontend/src/workflow/api';

const intake = 'Company: Source Studio\nFounder: Morgan\nSummary: Tools for teams\nAnnual revenue: 240000\nPeriod: 2026';
async function snapshot(page: Page): Promise<WorkflowCase> {
  const response = await page.request.get('/api/workflow/cases');
  expect(response.ok()).toBe(true);
  const data = await response.json() as { items: WorkflowCase[] };
  return data.items[0];
}
async function settled(page: Page): Promise<WorkflowCase> {
  await expect.poll(async () => (await snapshot(page)).jobs.some(job => ['queued', 'working'].includes(job.status))).toBe(false);
  return snapshot(page);
}
async function create(page: Page): Promise<void> {
  await page.goto('/founder/chat?workspace=backend');
  await page.getByRole('textbox', { name: 'Company name', exact: true }).fill('Source Studio');
  await page.getByLabel('What would you like to prepare?').fill('Prepare a source-backed fictional packet');
  await page.getByRole('button', { name: 'Create backend case' }).click();
  await expect(page.getByText('Live updates connected', { exact: true })).toBeVisible();
}
async function upload(page: Page, name: string, text: string): Promise<void> {
  await page.getByLabel('Add source in chat').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await expect.poll(async () => (await snapshot(page)).sources.some(source => source.name === name)).toBe(true);
  await settled(page);
  await expect(page.getByLabel('Add source in chat')).toBeEnabled();
}

test('source interpretation, deduplication, attributed answers and confirmed revision remain in one chat', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await create(page);
  await upload(page, 'statement.txt', intake);
  const first = await snapshot(page);
  expect(first.facts.annual_revenue.candidates[0].evidence[0].source_id).toBe(first.sources[0].id);
  expect(first.facts.cash_reserve.state).toBe('unknown');
  const tasks = page.getByRole('region', { name: 'Backend task progress' });
  await expect(tasks.getByText('Provide cash reserve', { exact: true })).toBeVisible();
  expect(first.tasks.some(task => /cash reserve/i.test(task.title) && task.state === 'Blocked')).toBe(true);

  await page.getByLabel('Add source in chat').setInputFiles({ name: 'same-bytes.txt', mimeType: 'text/plain', buffer: Buffer.from(intake) });
  await expect(page.getByText('This exact source was already saved. No duplicate analysis was started.')).toBeVisible();
  const duplicate = await settled(page);
  expect(duplicate.sources).toHaveLength(1);
  expect(duplicate.revision).toBe(first.revision);
  expect(duplicate.tasks.map(task => task.id)).toEqual(first.tasks.map(task => task.id));
  expect(duplicate.jobs).toHaveLength(first.jobs.length);

  await page.getByLabel('Message Relay about this packet').fill('Cash reserve: 60000');
  await page.getByRole('button', { name: 'Analyze with test AI' }).click();
  await expect(page.getByRole('textbox', { name: 'Cash reserve (USD)', exact: true })).toHaveValue('60000');
  const answer = await settled(page);
  const answerMessage = answer.messages.find(message => message.author === 'founder' && message.text === 'Cash reserve: 60000');
  expect(answerMessage).toBeTruthy();
  expect(answer.facts.cash_reserve.candidates.some(candidate => candidate.evidence.some(evidence => evidence.source_id === answerMessage?.id))).toBe(true);
  expect(answer.facts.cash_reserve.state).not.toBe('confirmed');
  await page.getByRole('checkbox', { name: /I reviewed the displayed evidence/ }).check();
  await page.getByRole('button', { name: 'Confirm reviewed values' }).click();
  await expect(page.getByRole('button', { name: 'Create confirmed PDF draft' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create confirmed PDF draft' }).click();
  const download = page.getByRole('link', { name: 'Download v1' });
  await expect(download).toBeVisible();
  const originalUrl = await download.getAttribute('href');
  const originalBytes = await (await page.request.get(originalUrl!)).body();

  await upload(page, 'statement-revised.txt', intake.replace('240000', '280000'));
  const proposed = await snapshot(page);
  expect(proposed.sources).toHaveLength(2);
  expect(proposed.sources[1].relationship).toBeFalsy();
  await expect(page.getByRole('button', { name: 'Confirm replacement relationship' })).toBeVisible();
  const decide = page.getByRole('button', { name: 'Confirm replacement relationship' });
  await decide.focus();
  await expect(decide).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await snapshot(page)).sources[1].relationship?.decision).toBe('revision');
  const changed = await settled(page);
  expect(changed.sources[0].id).toBe(first.sources[0].id);
  expect(changed.facts.annual_revenue.candidates.map(candidate => candidate.value)).toEqual(expect.arrayContaining(['240000', '280000']));
  expect(changed.tasks.some(task => /revenue/i.test(task.title) && task.state !== 'Done')).toBe(true);
  expect(await (await page.request.get(originalUrl!)).body()).toEqual(originalBytes);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath(`source-aware-${width}.png`), fullPage: true });
    await page.screenshot({ path: test.info().outputPath(`source-aware-viewport-${width}.png`) });
    await tasks.screenshot({ path: test.info().outputPath(`source-aware-tasks-${width}.png`) });
  }
  const savedIds = changed.tasks.map(task => task.id);
  await page.reload();
  await expect(page.getByText('Live updates connected', { exact: true })).toBeVisible();
  expect((await snapshot(page)).tasks.map(task => task.id)).toEqual(savedIds);
  await expect(page.getByRole('link', { name: 'Download v1' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('WebSocket reconnect recovers committed source state without replaying work', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    const observed = window as unknown as { relayTestSockets: WebSocket[] };
    observed.relayTestSockets = [];
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        observed.relayTestSockets.push(this);
      }
    };
  });
  await create(page);
  await upload(page, 'statement.txt', intake);
  const before = await snapshot(page);
  await page.evaluate(() => {
    const observed = window as unknown as { relayTestSockets: WebSocket[] };
    observed.relayTestSockets.at(-1)?.close();
  });
  await expect(page.getByText(/Live updates disconnected/)).toBeVisible();
  const session = await (await page.request.get('/api/workflow/session')).json() as { csrf_token: string };
  const uploadResponse = await page.request.post(`/api/workflow/cases/${before.id}/sources`, {
    headers: { 'X-CSRF-Token': session.csrf_token, 'Idempotency-Key': 'reconnect-upload' },
    multipart: { expected_revision: String(before.revision), analyze: 'true', file: { name: 'reserve.txt', mimeType: 'text/plain', buffer: Buffer.from('Cash reserve: 70000') } },
  });
  expect(uploadResponse.status()).toBe(201);
  await expect(page.getByText('Live updates connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Cash reserve (USD)', exact: true })).toHaveValue('70000');
  const after = await settled(page);
  expect(new Set(after.tasks.map(task => task.id)).size).toBe(after.tasks.length);
  expect(after.sources).toHaveLength(2);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Cash reserve (USD)', exact: true })).toHaveValue('70000');
});
