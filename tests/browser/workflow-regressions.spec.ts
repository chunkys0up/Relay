import { test, expect } from './fixtures';

test('private AI history survives reload and stays hidden from the advisor', async ({ page, context, documentsApi }) => {
  await page.goto('/founder/chat');
  await page.getByRole('textbox', { name: 'Message Relay' }).fill('Private founder marker 4271');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.founder-chat-conversation .message-bubble').filter({ hasText: 'Private founder marker 4271' })).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Chat history' })).toContainText('Offline model reply for this browser test.');
  await page.reload();
  await expect(page.locator('.founder-chat-conversation .message-bubble').filter({ hasText: 'Private founder marker 4271' })).toHaveCount(1);
  const advisor = await context.newPage();
  await advisor.goto('/advisor/clients?advisor_demo=browser');
  await expect(advisor.locator('.advisor-client-conversation .message-bubble').filter({ hasText: 'Private founder marker 4271' })).toHaveCount(0);
  expect(documentsApi.conversations.find(chat => chat.kind === 'ai')?.owner_role).toBe('founder');
});

test('confirmed human messages appear to both roles and remain after reload', async ({ page, context, documentsApi }) => {
  await page.goto('/founder/chat');
  await page.getByRole('tab', { name: 'Maya Chen', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message Maya Chen' }).fill('Shared founder marker 4271');
  await page.getByRole('button', { name: 'Preview message' }).click();
  await expect(page.getByRole('heading', { name: 'Preview message to Maya Chen' })).toBeVisible();
  const advisor = await context.newPage();
  await advisor.goto('/advisor/clients?audience=human');
  await expect(advisor.locator('.conversation .message-bubble').filter({ hasText: 'Shared founder marker 4271' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirm send' }).click();
  await expect(page.locator('.founder-chat-conversation .message-bubble').filter({ hasText: 'Shared founder marker 4271' })).toHaveCount(1);
  await advisor.reload();
  await expect(advisor.locator('.conversation .message-bubble').filter({ hasText: 'Shared founder marker 4271' })).toHaveCount(1);
  await advisor.getByRole('textbox', { name: 'Message Alex Morgan' }).fill('Advisor response marker 4271');
  await advisor.getByRole('button', { name: 'Preview message' }).click();
  await advisor.getByRole('button', { name: 'Confirm send' }).click();
  await page.reload();
  await page.getByRole('tab', { name: 'Maya Chen', exact: true }).click();
  await expect(page.locator('.founder-chat-conversation .message-bubble').filter({ hasText: 'Advisor response marker 4271' })).toHaveCount(1);
  expect(documentsApi.conversations.filter(chat => chat.kind === 'human')).toHaveLength(1);
  expect(documentsApi.messages.filter(message => message.conversation_id === documentsApi.conversations[0].id)).toHaveLength(2);
});

test('a new chat and historical chat can be selected independently', async ({ page, documentsApi }) => {
  await page.goto('/founder/chat');
  await page.getByRole('textbox', { name: 'Message Relay' }).fill('First saved planning question');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.founder-chat-conversation .message-bubble').filter({ hasText: 'First saved planning question' })).toHaveCount(1);
  await page.getByRole('button', { name: '+ New chat' }).click();
  await expect(page.locator('.founder-chat-conversation .message-bubble').filter({ hasText: 'First saved planning question' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Message Relay' }).fill('Second saved planning question');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.founder-chat-conversation .message-bubble').filter({ hasText: 'Second saved planning question' })).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Chat history' }).locator('li button')).toHaveCount(2);
  await page.getByRole('navigation', { name: 'Chat history' }).locator('li button').last().click();
  await expect(page.locator('.founder-chat-conversation .message-bubble').filter({ hasText: 'First saved planning question' })).toHaveCount(1);
  expect(documentsApi.conversations.filter(chat => chat.kind === 'ai')).toHaveLength(2);
});
