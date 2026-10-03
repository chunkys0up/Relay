import { test, expect } from './fixtures';

for (const viewport of [{ width: 1440, height: 900 }, { width: 1254, height: 600 }, { width: 950, height: 700 }, { width: 680, height: 650 }, { width: 390, height: 844 }]) {
  test(`sidebar bounds and scroll access at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.route('**/api/advisor/**', route => route.fulfill({ status: 503, json: { error: { message: 'Advisor server is offline.', retryable: true } } }));
    await page.goto('/advisor/clients');
    await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeInViewport();
    await expect(page.getByText('Advisor server is offline.', { exact: true })).toBeVisible();
    const bounds = await page.locator('main').evaluate(main => ({ width: main.clientWidth, content: main.scrollWidth }));
    expect(bounds.content).toBeLessThanOrEqual(bounds.width + 1);
    if (viewport.width > 1100) {
      const main = await page.locator('main').boundingBox();
      for (const selector of ['.advisor-client-rail', '.advisor-client-assistant']) {
        const box = await page.locator(selector).boundingBox();
        expect(box!.y).toBeGreaterThanOrEqual(main!.y - 1);
        expect(box!.y + box!.height).toBeLessThanOrEqual(main!.y + main!.height + 1);
      }
      await page.locator('.advisor-client-workspace').evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeInViewport();
      await expect(page.getByRole('heading', { name: 'Relay AI', exact: true })).toBeInViewport();
    }
    await page.locator('.advisor-client-conversation .composer textarea').scrollIntoViewIfNeeded();
    await expect(page.locator('.advisor-client-conversation .composer textarea')).toBeInViewport();
    await page.getByRole('button', { name: 'Reconnect advisor server', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Reconnect advisor server', exact: true })).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath('sidebars.png') });
    await page.getByRole('combobox', { name: 'Demo role' }).selectOption('founder');
    await page.getByRole('link', { name: 'AI Chat', exact: true }).click();
    await expect(page.locator('.founder-chat-header h1')).toBeInViewport();
    await expect(page.locator('.founder-chat-conversation .composer textarea')).toBeInViewport();
    expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}
