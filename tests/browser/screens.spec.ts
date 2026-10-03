import { test, expect } from './fixtures';

const routes = [
  ['founder Home', '/founder/home'],
  ['founder AI Chat', '/founder/chat'],
  ['founder Sources', '/founder/sources'],
  ['founder Documents', '/founder/documents'],
  ['founder shared review', '/founder/call'],
  ['advisor Home', '/advisor/home'],
  ['advisor Clients', '/advisor/clients'],
  ['advisor Reviews', '/advisor/reviews'],
  ['advisor Documents', '/advisor/documents?advisor_demo=browser'],
  ['advisor Call', '/advisor/call'],
] as const;

for (const [name, route] of routes) {
  test(`${name} renders on desktop and mobile without broken assets or horizontal overflow`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    const assets = await page.locator('img:visible').evaluateAll(images => images.map(image =>
      image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width > 0));
    expect(assets.every(Boolean)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('main')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('founder Home uploads actual file bytes and reloads the backend listing', async ({ page, documentsApi }) => {
  await page.goto('/founder/home');
  await page.getByLabel('Upload documents', { exact: true }).setInputFiles({
    name: 'backend-intake.txt', mimeType: 'text/plain', buffer: Buffer.from('Unique uploaded source evidence 4271'),
  });
  await expect.poll(() => documentsApi.uploads.length).toBe(1);
  expect(documentsApi.uploads[0].content.toString()).toBe('Unique uploaded source evidence 4271');
  await expect(page.getByRole('button', { name: 'backend-intake.txt', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'backend-intake.txt', exact: true })).toBeVisible();
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'backend-intake.txt', exact: true }).click();
  const preview = await opened;
  await expect(preview.locator('body')).toHaveText('Unique uploaded source evidence 4271');
  await page.goto('/founder/sources?q=backend-intake');
  await expect(page.getByRole('heading', { name: 'No sources match this search' })).toBeVisible();
});
