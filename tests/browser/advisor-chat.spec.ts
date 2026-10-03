import { expect, test } from './fixtures';
import type { Page, Route } from '@playwright/test';

const version = { id: '00000000-0000-4000-8000-000000000021', version: 1, hash: 'a'.repeat(64), title: 'Founder planning packet', source_ids: ['00000000-0000-4000-8000-000000000011'] };
const caseId = 'server-case';
const sourceId = version.source_ids[0];
const sourceHash = 'b'.repeat(64);
const citationUrl = `/api/advisor/cases/${caseId}/sources/${sourceId}/preview?version_id=${version.id}&packet_hash=${version.hash}&source_hash=${sourceHash}`;
const session = { mode: 'synthetic', provider: 'bedrock', csrf_token: 'csrf', workspace: { case_id: caseId, company: 'Northstar Labs', advisor: { id: 'advisor-1', name: 'Maya Chen' }, versions: [version] } };
const empty = { conversation_id: 'conversation-1', case_id: caseId, versions: [{ id: version.id, hash: version.hash }], messages: [] as unknown[] };

function reply(question: string, key: string) {
  return { ...empty, messages: [
    { id: 'user-1', role: 'user', request_key: key, text: question, created_at: '2026-10-02T00:00:00Z', citations: [] },
    { id: 'answer-1', role: 'assistant', request_key: key, text: 'The intake says $240,000 while the forecast says $280,000. Confirm which figure is final.', kind: 'conflict', created_at: '2026-10-02T00:00:01Z', citations: [{ source_id: sourceId, source_hash: sourceHash, version_id: version.id, label: 'Founder intake', field: 'annual_revenue', url: citationUrl }], draft_questions: ['Which revenue amount is final?'] },
  ] };
}

async function mockAdvisor(page: Page, options: { failFirstSend?: boolean } = {}) {
  let saved = empty;
  let sends = 0;
  const keys: string[] = [];
  const genericCalls: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/documents')) genericCalls.push(request.url()); });
  await page.route('**/api/advisor/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/advisor/session') return route.fulfill({ json: session });
    if (path.endsWith('/preview')) return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Server-only packet text: annual revenue has two conflicting figures.' });
    if (path.endsWith('/messages') && request.method() === 'POST') {
      sends += 1;
      keys.push(request.headers()['idempotency-key']);
      if (options.failFirstSend && sends === 1) return route.fulfill({ status: 503, json: { error: { code: 'MODEL_UNAVAILABLE', message: 'Model unavailable', retryable: true } } });
      saved = reply((request.postDataJSON() as { text: string }).text, request.headers()['idempotency-key']);
      return route.fulfill({ json: saved });
    }
    if (path.endsWith('/conversations') && request.method() === 'GET') return route.fulfill({ json: { items: saved.messages.length ? [saved] : [] } });
    if (path.endsWith('/conversations') && request.method() === 'POST') return route.fulfill({ json: saved });
    if (path.endsWith('/conversation-1') && request.method() === 'GET') return route.fulfill({ json: saved });
    return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_ROUTE', message: path } } });
  });
  return { keys, genericCalls };
}

test('advisor server packet, grounded chat, private draft and reload remain in one exact context', async ({ page }) => {
  const observed = await mockAdvisor(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1500, height: 960 });
  await page.goto('/advisor/clients');
  await expect(page.getByRole('button', { name: 'Open server synthetic advisor workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'Open server synthetic advisor workspace' }).click();
  await expect(page.getByRole('article', { name: 'Server packet version 1' })).toContainText('Server-only packet text');
  await expect(page.getByText(/Chat and the center preview use server packet v1/)).toBeVisible();
  await page.getByRole('textbox', { name: /Ask about shared packet v1/ }).fill('What conflicts?');
  await page.getByRole('button', { name: 'Ask advisor AI' }).click();
  await expect(page.getByText(/The intake says \$240,000/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Founder intake/ })).toHaveAttribute('href', new RegExp('packet_hash=' + version.hash));
  const draft = page.getByRole('textbox', { name: 'Private follow-up draft' });
  await draft.fill('Please confirm the revenue figure.');
  await page.reload();
  await expect(page.getByText(/The intake says \$240,000/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Private follow-up draft' })).toHaveValue('Please confirm the revenue figure.');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(observed.genericCalls).toEqual([]);
  expect(errors).toEqual([]);
});

test('advisor failed answer retries with same idempotency key and no duplicate rendered answer', async ({ page }) => {
  const observed = await mockAdvisor(page, { failFirstSend: true });
  await page.goto('/advisor/clients');
  await page.getByRole('button', { name: 'Open server synthetic advisor workspace' }).click();
  await expect(page.getByText(/No private messages for this server packet/)).toBeVisible();
  await page.getByRole('textbox', { name: /Ask about shared packet v1/ }).fill('What conflicts?');
  await page.getByRole('button', { name: 'Ask advisor AI' }).click();
  await expect(page.getByRole('alert')).toContainText('Model unavailable');
  await page.getByRole('button', { name: 'Retry request' }).click();
  await expect(page.getByText(/The intake says \$240,000/)).toHaveCount(1);
  expect(observed.keys).toHaveLength(2);
  expect(observed.keys[0]).toBe(observed.keys[1]);
});

test('advisor Home and Documents never request the unscoped live document catalog', async ({ page }) => {
  const observed = await mockAdvisor(page);
  await page.goto('/advisor/home');
  await expect(page.getByRole('heading', { name: 'Shared documents' })).toBeVisible();
  await page.goto('/advisor/documents');
  await expect(page.getByRole('heading', { name: 'Shared sources' })).toBeVisible();
  expect(observed.genericCalls).toEqual([]);
});
