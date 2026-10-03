import { test, expect } from './fixtures';

test('failed human send keeps the draft and retry saves one message', async ({ page, documentsApi }) => {
  let fail = true;
  await page.route('**/api/cases/*/conversations', async route => {
    if (route.request().method() === 'POST' && fail) {
      await route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, json: { detail: 'Message service unavailable' } });
      return;
    }
    await route.fallback();
  });
  await page.goto('/founder/chat?audience=human');
  const input = page.getByRole('textbox', { name: 'Message Maya Chen' });
  await input.fill('Please review my reserve target.');
  await page.getByRole('button', { name: 'Preview message' }).click();
  await page.getByRole('button', { name: 'Confirm send' }).click();
  await expect(page.getByRole('alert')).toContainText('Message service unavailable');
  await expect(input).toHaveValue('Please review my reserve target.');
  expect(documentsApi.conversations).toHaveLength(0);
  fail = false;
  await page.getByRole('button', { name: 'Preview message' }).click();
  await page.getByRole('button', { name: 'Confirm send' }).click();
  await expect(page.locator('.founder-chat-conversation .message-bubble').filter({ hasText: 'Please review my reserve target.' })).toHaveCount(1);
  expect(documentsApi.messages.filter(message => message.content === 'Please review my reserve target.')).toHaveLength(1);
});

test('open human conversation refreshes a new message from another tab', async ({ page, context }) => {
  await page.goto('/founder/chat?audience=human');
  await page.getByRole('textbox', { name: 'Message Maya Chen' }).fill('Initial shared conversation');
  await page.getByRole('button', { name: 'Preview message' }).click();
  await page.getByRole('button', { name: 'Confirm send' }).click();
  const advisor = await context.newPage();
  await advisor.goto('/advisor/clients?audience=human');
  await advisor.getByRole('textbox', { name: 'Message Alex Morgan' }).fill('Live advisor reply');
  await advisor.getByRole('button', { name: 'Preview message' }).click();
  await advisor.getByRole('button', { name: 'Confirm send' }).click();
  await expect(page.locator('.founder-chat-conversation .message-bubble').filter({ hasText: 'Live advisor reply' })).toHaveCount(1, { timeout: 10000 });
});
