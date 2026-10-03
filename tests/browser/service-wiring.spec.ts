import { test, expect } from './fixtures';

const caseId = '22222222-2222-2222-2222-222222222222';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS', 'Access-Control-Allow-Headers': '*' };

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`sidebar checklist follows confirmed service state and retries at ${viewport.width}px`, async ({ page, documentsApi }) => {
    await page.setViewportSize(viewport);
    documentsApi.checklist.push({ id: 'service-task', case_id: caseId, title: 'Verify current evidence', detail: null,
      state: 'todo', position: 0, created_by: 'agent', created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:00Z' });
    let failed = true;
    await page.route('**/api/cases/*/checklist/service-task', async route => {
      if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
      if (failed) { await route.fulfill({ status: 503, headers, json: { detail: 'Checklist service unavailable' } }); return; }
      documentsApi.checklist[0].state = 'blocked';
      await route.fulfill({ headers, json: documentsApi.checklist[0] });
    });
    await page.goto('/founder/home');
    const checkbox = page.getByRole('checkbox', { name: 'Verify current evidence: mark done' });
    await expect(checkbox).toBeVisible();
    await checkbox.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Checklist service unavailable' })).toBeVisible();
    await expect(checkbox).toHaveAttribute('aria-checked', 'false');
    failed = false;
    await checkbox.click();
    await expect(page.locator('.case-sidebar-checklist')).toContainText('Blocked');
    await expect(checkbox).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('progressbar', { name: 'Checklist items done' })).toHaveAttribute('aria-valuenow', '0');
    expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });
}

test('unavailable checklist and documents expose service errors', async ({ page }) => {
  await page.route('**/api/documents?**', route => route.fulfill({ status: 503, headers, json: { detail: 'Documents unavailable' } }));
  await page.route('**/api/cases/*/checklist', route => route.fulfill({ status: 503, headers, json: { detail: 'Checklist unavailable' } }));
  await page.goto('/founder/home');
  await expect(page.getByRole('alert').filter({ hasText: 'Documents unavailable' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Checklist unavailable' })).toBeVisible();
});

test('advisor private notes stay local and never call founder chat or upload services', async ({ page, documentsApi }) => {
  await page.goto('/advisor/clients?advisor_demo=browser');
  const local = page.locator('.advisor-client-conversation .conversation');
  await expect(local.getByRole('textbox', { name: 'Message Relay' })).toBeVisible();
  await expect(local.getByRole('button', { name: 'Add file' })).toHaveCount(0);
  await local.getByRole('textbox', { name: 'Message Relay' }).fill('Private advisor note for later review.');
  await local.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(local.locator('.message-bubble').filter({ hasText: 'Private advisor note for later review.' })).toHaveCount(1);
  expect(documentsApi.chatRequests).toHaveLength(0);
  expect(documentsApi.uploads).toHaveLength(0);
  await expect(local.locator('.conversation-footnote')).toContainText('Local notes');
  await page.reload();
  await expect(page.locator('.advisor-client-conversation .message-bubble').filter({ hasText: 'Private advisor note for later review.' })).toHaveCount(1);
});

test('founder assistant failure and retry use the saved conversation service', async ({ page, documentsApi }) => {
  let failed = true;
  await page.route('**/api/chat/stream', async route => {
    if (failed) { await route.fulfill({ status: 503, headers, json: { detail: 'Synthetic chat service failure' } }); return; }
    await route.fallback();
  });
  await page.goto('/founder/chat');
  const local = page.locator('.founder-chat-conversation .conversation');
  await local.getByRole('textbox', { name: 'Message Relay' }).fill('Explain the next step.');
  await local.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(local.getByRole('alert')).toContainText('Synthetic chat service failure');
  failed = false;
  await local.getByRole('textbox', { name: 'Message Relay' }).fill('Explain the next step again.');
  await local.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(local.locator('.message-bubble').filter({ hasText: 'Offline model reply for this browser test.' })).toHaveCount(1);
  expect(documentsApi.chatRequests.at(-1)?.case_id).toBe(caseId);
  await page.reload();
  await expect(page.locator('.founder-chat-conversation .message-bubble').filter({ hasText: 'Offline model reply for this browser test.' })).toHaveCount(1);
});
