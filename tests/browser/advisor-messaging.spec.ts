import { test, expect } from './fixtures';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`advisor messages the client from Home at ${viewport.width}px`, async ({ page, documentsApi }) => {
    await page.setViewportSize(viewport);
    await page.goto('/advisor/home');
    await page.getByRole('link', { name: 'Message client' }).click();
    await expect(page).toHaveURL(/\/advisor\/clients\?audience=human#message-side$/);
    await expect(page.getByRole('heading', { name: 'Messages with Alex Morgan' })).toBeVisible();
    const composer = page.getByRole('textbox', { name: 'Message Alex Morgan' });
    await expect(composer).toBeInViewport();
    await composer.fill('Can we discuss the latest packet?');
    await page.getByRole('button', { name: 'Preview message' }).click();
    await expect(page.getByRole('heading', { name: 'Preview message to Alex Morgan' })).toBeVisible();
    await expect(page.locator('.conversation .message-bubble').filter({ hasText: 'Can we discuss the latest packet?' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Confirm send' }).click();
    await expect(page.locator('.advisor-client-conversation .message-bubble').filter({ hasText: 'Can we discuss the latest packet?' })).toHaveCount(1);
    expect(documentsApi.conversations).toHaveLength(1);
    expect(documentsApi.conversations[0].kind).toBe('human');
    await page.reload();
    await expect(page.locator('.advisor-client-conversation .message-bubble').filter({ hasText: 'Can we discuss the latest packet?' })).toHaveCount(1);
    await page.getByRole('combobox', { name: 'Demo role' }).selectOption('founder');
    await page.goto('/founder/chat?audience=human');
    await expect(page.locator('.founder-chat-conversation .message-bubble').filter({ hasText: 'Can we discuss the latest packet?' })).toHaveCount(1);
    expect(documentsApi.chatRequests).toHaveLength(0);
    expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });
}

test('Clients preserves document selection and an unsent draft across communication views', async ({ page }) => {
  await page.goto('/advisor/clients?source=00000000-0000-4000-8000-000000000011&q=Northstar');
  await expect(page.getByText(/2026 annual revenue: \$240,000/)).toBeVisible();
  await page.getByRole('button', { name: 'Messages' }).click();
  await expect(page).toHaveURL(/source=00000000-0000-4000-8000-000000000011.*q=Northstar.*audience=human#message-side/);
  await page.getByRole('textbox', { name: 'Message Alex Morgan' }).fill('Draft for Alex only');
  await page.getByRole('button', { name: 'Private AI', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Message Relay' })).not.toHaveValue('Draft for Alex only');
  await page.getByRole('button', { name: 'Messages' }).click();
  await expect(page.getByRole('textbox', { name: 'Message Alex Morgan' })).toHaveValue('Draft for Alex only');
  await expect(page.locator('.conversation .message-bubble').filter({ hasText: 'Draft for Alex only' })).toHaveCount(0);
});
