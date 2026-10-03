import { test, expect } from './fixtures';

const caseId = '22222222-2222-2222-2222-222222222222';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS', 'Access-Control-Allow-Headers': '*' };

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`checklist displays confirmed service values and supports retry at ${viewport.width}px`, async ({ page, documentsApi }) => {
    await page.setViewportSize(viewport);
    documentsApi.checklist.push({ id: 'service-task', case_id: caseId, title: 'Verify current evidence', detail: null,
      state: 'todo', position: 0, created_by: 'agent', created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:00Z' });
    let failed = true;
    await page.route('**/api/cases/*/checklist/service-task', async route => {
      if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
      if (failed) { await route.fulfill({ status: 503, headers, json: { detail: 'Checklist service unavailable' } }); return; }
      // The authoritative service may normalize the requested done state to blocked.
      documentsApi.checklist[0].state = 'blocked';
      await route.fulfill({ headers, json: documentsApi.checklist[0] });
    });
    await page.goto('/founder/home');
    const checkbox = page.getByRole('checkbox', { name: 'Verify current evidence: mark done' });
    await checkbox.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Checklist service unavailable' })).toBeVisible();
    await expect(checkbox).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('0 of 1 done · 0 files received', { exact: true })).toBeVisible();
    failed = false;
    await checkbox.click();
    await expect(page.locator('.founder-home-checklist')).toContainText('Blocked');
    await expect(page.getByText('Checklist service unavailable', { exact: true })).toHaveCount(0);
    await expect(checkbox).toHaveAttribute('aria-checked', 'false');
    expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('confirmed-checklist.png') });
  });
}

test('unavailable services do not appear as zero totals or completed next steps', async ({ page }) => {
  await page.route('**/api/documents?**', route => route.fulfill({ status: 503, headers, json: { detail: 'Documents unavailable' } }));
  await page.route('**/api/cases/*/checklist', route => route.fulfill({ status: 503, headers, json: { detail: 'Checklist unavailable' } }));
  await page.goto('/founder/home');
  await expect(page.getByText('Checklist unavailable · File count unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Checklist items done' })).toHaveCount(0);
  await expect(page.getByText('Next steps are unavailable until the checklist loads.', { exact: true })).toBeVisible();
});

test('advisor browser notes never use founder chat or upload services', async ({ page, documentsApi }) => {
  await page.goto('/advisor/clients?advisor_demo=browser');
  const local = page.locator('.conversation');
  await expect(local.getByRole('textbox', { name: 'Message Relay' })).toBeVisible();
  await expect(local.getByRole('button', { name: 'Add file' })).toHaveCount(0);
  await local.getByRole('textbox', { name: 'Message Relay' }).fill('Private local advisor note for later review.');
  await local.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(local.locator('.message-bubble').filter({ hasText: 'Private local advisor note for later review.' })).toHaveCount(1);
  expect(documentsApi.chatRequests).toHaveLength(0);
  expect(documentsApi.uploads).toHaveLength(0);
  await expect(local.locator('.conversation-footnote').getByText('Local notes', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.conversation .message-bubble').filter({ hasText: 'Private local advisor note for later review.' })).toHaveCount(1);
});

test('founder assistant status follows failed and successful requests', async ({ page, documentsApi }) => {
  let failed = true;
  await page.route('**/api/chat/stream', async route => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (failed) { await route.fulfill({ status: 503, headers, json: { detail: 'Synthetic chat service failure' } }); return; }
    documentsApi.chatRequests.push(route.request().postDataJSON());
    await route.fulfill({ headers, contentType: 'text/plain', body: 'The service returned this complete answer.' });
  });
  await page.goto('/founder/chat');
  const local = page.locator('.conversation');
  await expect(local.getByText('Live AI', { exact: true })).toHaveCount(0);
  await local.getByRole('textbox', { name: 'Message Relay' }).fill('Explain the next step.');
  await local.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(local.getByRole('alert')).toContainText('Synthetic chat service failure');
  await expect(local.locator('.conversation-footnote').getByText('AI unavailable', { exact: true })).toBeVisible();
  failed = false;
  await local.getByRole('textbox', { name: 'Message Relay' }).fill('Explain the next step again.');
  await local.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(local.locator('.message-bubble').filter({ hasText: 'The service returned this complete answer.' })).toHaveCount(1);
  await expect(local.locator('.conversation-footnote').getByText('Connected', { exact: true })).toBeVisible();
  expect(documentsApi.chatRequests).toHaveLength(1);
  expect(documentsApi.chatRequests[0].case_id).toBe(caseId);
});
