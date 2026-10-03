import { test, expect } from '@playwright/test';

const v1 = '00000000-0000-4000-8000-000000000021';
const v2 = '00000000-0000-4000-8000-000000000022';

test('Documents loads server evidence, reviews selected versions, persists drafts and follows source links', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/advisor/documents');
  await expect(page.getByRole('article', { name: 'Server packet version 2' })).toContainText('$260,000');
  await expect(page.getByText('Connected · private history saved on server', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Server shared packet', exact: true }).selectOption(v1);
  await expect(page.getByRole('article', { name: 'Server packet version 1' })).toContainText('$240,000');
  await page.getByRole('button', { name: 'Missing or conflicting evidence', exact: true }).click();
  const answer = page.locator('.advisor-chat-message').filter({ hasText: 'Relay advisor AI' });
  await expect(answer).toContainText('$280,000');
  await expect(answer).toContainText('Reserve target: not provided.');
  const draft = page.getByRole('textbox', { name: 'Private follow-up draft', exact: true }).first();
  await draft.fill('Please clarify the reserve target.');
  await page.reload();
  await expect(draft).toHaveValue('Please clarify the reserve target.');
  await page.getByRole('textbox', { name: 'Search documents' }).fill('Forecast');
  await page.getByRole('button', { name: /Forecast assumptions/ }).click();
  await expect(page.getByRole('article', { name: 'Shared source preview' })).toContainText('$280,000');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open authorized source text' }).click();
  const popup = await popupPromise;
  await expect(popup.locator('body')).toContainText('$280,000');
  await popup.close();
  await page.getByRole('button', { name: 'Return to packet v1' }).click();
  await page.getByRole('textbox', { name: 'Search documents' }).fill('');
  await page.screenshot({ path: test.info().outputPath('documents-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('documents-narrow.png'), fullPage: true });
  await page.getByRole('combobox', { name: 'Server shared packet', exact: true }).selectOption(v2);
  await expect(page.getByRole('article', { name: 'Server packet version 2' })).toContainText('$260,000');
  await expect(answer).toHaveCount(0);
  await page.getByRole('link', { name: '← Back to clients' }).click();
  await expect(page).toHaveURL(new RegExp(`server_version=${v2}`));
  await page.getByRole('link', { name: 'Open connected documents' }).click();
  await expect(page.getByRole('article', { name: 'Server packet version 2' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Documents fails visibly, retries, and rejects unknown selected versions', async ({ page }) => {
  await page.route('**/api/advisor/cases/*/packets/*/documents?*', route => route.fulfill({ status: 503, json: { error: { message: 'Documents temporarily unavailable' } } }));
  await page.goto('/advisor/documents');
  await expect(page.getByRole('alert')).toContainText('Documents temporarily unavailable');
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.unroute('**/api/advisor/cases/*/packets/*/documents?*');
  await page.getByRole('button', { name: 'Retry documents' }).click();
  await expect(page.getByRole('article', { name: 'Server packet version 2' })).toBeVisible();
  await page.goto('/advisor/documents?server_version=unshared');
  await expect(page.getByRole('heading', { name: 'Shared version unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask advisor AI' })).toHaveCount(0);
});
