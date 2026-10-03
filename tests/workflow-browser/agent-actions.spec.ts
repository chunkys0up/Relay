import { test, expect } from '@playwright/test';

test('real Strands tool loop proposes a PDF and saves only after review', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/founder/home?workspace=backend');
  await page.getByRole('textbox', { name: 'Company name', exact: true }).fill('Tool Studio');
  await page.getByRole('textbox', { name: 'What would you like to prepare?' }).fill('Fill my planning PDF');
  await page.getByRole('button', { name: 'Create backend case' }).click();
  await expect(page.getByText('Live updates connected', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Continue in AI Chat' }).click();
  await page.getByLabel('Message Relay about this packet').fill('Edit PDF\nCompany: Tool Studio\nFounder: Alex\nSummary: Software for teams\nAnnual revenue: 280000\nCash reserve: 60000\nPeriod: 2026');
  await page.getByRole('button', { name: 'Analyze with test AI' }).click();
  const card = page.getByRole('region', { name: 'Proposed PDF version 1', exact: true });
  await expect(card).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download v1' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Save reviewed PDF version' })).toBeDisabled();
  const previewUrl = await card.getByRole('link', { name: 'Open proposed PDF preview in a new tab' }).getAttribute('href');
  const preview = await page.request.get(previewUrl!);
  expect(preview.status()).toBe(200);
  const bytes = await preview.body();
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`agent-pdf-preview-${width}.png`), fullPage: true });
  }
  await card.getByRole('checkbox', { name: /I reviewed this PDF preview/ }).check();
  await card.getByRole('button', { name: 'Save reviewed PDF version' }).click();
  await expect(page.getByRole('link', { name: 'Download v1' })).toBeVisible();
  const packetUrl = await page.getByRole('link', { name: 'Download v1' }).getAttribute('href');
  expect(await (await page.request.get(packetUrl!)).body()).toEqual(bytes);
  await page.getByLabel('Message Relay about this packet').fill('Edit PDF\nCash reserve: 75000');
  await page.getByRole('button', { name: 'Analyze with test AI' }).click();
  const second = page.getByRole('region', { name: 'Proposed PDF version 2', exact: true });
  await expect(second).toBeVisible();
  await expect(second.getByText('75000', { exact: true })).toBeVisible();
  await second.getByRole('checkbox', { name: /I reviewed this PDF preview/ }).check();
  await second.getByRole('button', { name: 'Save reviewed PDF version' }).click();
  await expect(page.getByRole('link', { name: 'Download v2' })).toBeVisible();
  expect(await (await page.request.get(packetUrl!)).body()).toEqual(bytes);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Download v2' })).toBeVisible();
  expect(errors).toEqual([]);
});
