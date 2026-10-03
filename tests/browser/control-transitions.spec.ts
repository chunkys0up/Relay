import { test, expect } from './fixtures';

for (const role of ['founder', 'advisor'] as const) {
  test(`${role} primary navigation, brand, role switch and skip link`, async ({ page }) => {
    await page.goto(`/${role}/home`);
    const nav = page.locator('.navigation');
    const labels = role === 'founder' ? ['Home', 'AI Chat', 'Documents'] : ['Home', 'Clients', 'Call'];
    const paths = role === 'founder' ? ['/founder/home', '/founder/chat', '/founder/call'] : ['/advisor/home', '/advisor/clients', '/advisor/call'];
    for (let i = 0; i < labels.length; i++) {
      await nav.getByRole('link', { name: labels[i], exact: true }).click();
      await expect(page).toHaveURL(new RegExp(paths[i] + '$'));
      await expect(nav.getByRole('link', { name: labels[i], exact: true })).toHaveAttribute('aria-current', 'page');
    }
    await page.getByRole('link', { name: 'Relay home' }).click();
    await expect(page).toHaveURL(new RegExp(`/${role}/home$`));
    await page.getByRole('link', { name: 'Skip to main content' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    await page.getByRole('combobox', { name: 'Demo role' }).selectOption(role === 'founder' ? 'advisor' : 'founder');
    await expect(page).toHaveURL(role === 'founder' ? /\/advisor\/home$/ : /\/founder\/home$/);
  });

  test(`${role} Search filters sources and opens an exact packet version`, async ({ page }) => {
    await page.goto(`/${role}/home`);
    await page.getByRole('textbox', { name: 'Search sources and drafts' }).fill('founder');
    await page.getByRole('textbox', { name: 'Search sources and drafts' }).press('Enter');
    await expect(page).toHaveURL(new RegExp(`/${role}/search\\?q=founder`));
    await expect(page.locator('main')).toContainText('Founder planning packet');
    await page.getByRole('button', { name: /^Documents \(/ }).click();
    await expect(page.locator('main').getByRole('link', { name: /Founder intake.pdf/ })).toHaveCount(0);
    await page.getByRole('button', { name: /^Sources \(/ }).click();
    await expect(page.locator('main').getByRole('link', { name: /Founder intake.pdf/ }).first()).toBeVisible();
    await page.getByRole('button', { name: /^All \(/ }).click();
    await page.locator('main').getByRole('link', { name: /Founder planning packet/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${role}/documents\\?version=`));
    await expect(page.getByRole('region', { name: 'Packet version 1 preview' })).toBeVisible();
  });

  test(`${role} Settings keyboard tabs and document link`, async ({ page }) => {
    await page.goto(`/${role}/settings`);
    await page.getByRole('tab', { name: 'Profile', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Call privacy', exact: true })).toBeFocused();
    await expect(page.getByRole('tabpanel')).toContainText('consent');
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'About this demo', exact: true })).toBeFocused();
    await page.getByRole('link', { name: 'Explore documents' }).click();
    await expect(page).toHaveURL(new RegExp(`/${role}/documents$`));
  });
}

test('founder Home filters uploaded originals and packet versions', async ({ page, documentsApi }) => {
  await page.goto('/founder/home');
  for (const name of ['balance.csv', 'overview.txt']) {
    await page.getByLabel('Upload documents').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('Offline original: ' + name) });
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  expect(documentsApi.uploads).toHaveLength(2);
  await page.getByRole('searchbox', { name: 'Search documents' }).fill('balance');
  await expect(page.getByRole('button', { name: 'balance.csv' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'overview.txt' })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search documents' }).fill('');
  await page.getByRole('button', { name: 'Packets' }).click();
  await expect(page.getByRole('link', { name: 'Founder planning packet v1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'balance.csv' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Original files' }).click();
  await expect(page.getByRole('link', { name: 'Founder planning packet v1' })).toHaveCount(0);
  await page.getByRole('button', { name: 'All documents' }).click();
  await page.getByRole('link', { name: 'Founder planning packet v1' }).click();
  await expect(page.getByRole('region', { name: 'Packet version 1 preview' })).toBeVisible();
});

test('founder Sources search, citations, and Documents version history', async ({ page }) => {
  await page.goto('/founder/sources');
  await page.getByRole('button', { name: /Cap table summary.xlsx/ }).click();
  await expect(page.locator('.founder-sources-preview-title h2')).toHaveText('Cap table summary.xlsx');
  await page.getByRole('searchbox', { name: 'Search original sources' }).fill('nothing matches');
  await expect(page.getByRole('heading', { name: 'No sources match this search' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.goto('/founder/documents');
  await page.getByRole('tab', { name: 'Version history' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Version history' })).toContainText('Initial synthetic draft');
  await page.getByRole('button', { name: /View version 1/ }).click();
  await expect(page.getByRole('region', { name: 'Packet version 1 preview' })).toBeVisible();
});

test('advisor Clients source selection and Reviews link keep shared packet context', async ({ page }) => {
  await page.goto('/advisor/clients');
  await page.getByRole('button', { name: /Founder intake.pdf/ }).click();
  await expect(page.locator('.source-excerpt')).toContainText('$240,000');
  await page.getByRole('textbox', { name: 'Search assigned clients' }).fill('nothing matches');
  await expect(page.getByRole('heading', { name: 'No matching assigned client' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.goto('/advisor/reviews');
  await page.getByRole('link', { name: 'Open document review' }).click();
  await expect(page.getByRole('region', { name: 'Packet version 1 preview' })).toBeVisible();
});

test('advisor approval controls require explicit confirmation', async ({ page }) => {
  await page.goto('/advisor/reviews');
  const question = page.getByRole('textbox', { name: 'Draft question to Alex Morgan' });
  await question.fill('Which revenue figure is final?');
  await page.getByRole('button', { name: 'Preview questions' }).click();
  await expect(page.getByRole('heading', { name: 'Question preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel preview' }).click();
  await page.getByRole('button', { name: 'Review approval of v1' }).click();
  await expect(page.getByRole('heading', { name: 'Approve packet v1?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel approval' }).click();
  await expect(page.getByRole('heading', { name: 'Approve packet v1?' })).toHaveCount(0);
});

test('a revised packet reaches the advisor only after an exact source grant', async ({ page }) => {
  await page.goto('/advisor/reviews');
  await page.getByRole('button', { name: 'Preview questions' }).click();
  await page.getByRole('button', { name: 'Confirm simulated send' }).click();
  await page.getByRole('button', { name: 'Return review with sent question' }).click();
  await page.getByRole('combobox', { name: 'Demo role' }).selectOption('founder');
  await page.getByRole('link', { name: "Answer Maya Chen's question" }).click();
  await page.getByRole('textbox', { name: 'Answer Maya Chen’s question' }).fill('Final revenue is $240,000 and reserve target is $60,000.');
  await page.getByRole('button', { name: 'Preview answer' }).click();
  await page.getByRole('button', { name: 'Create simulated draft v2' }).click();
  await page.getByRole('link', { name: 'Review packet v2' }).click();
  await expect(page.getByRole('region', { name: 'Packet version 2 preview' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Demo role' }).selectOption('advisor');
  await page.goto('/advisor/documents?advisor_demo=browser');
  await expect(page.getByRole('region', { name: 'Packet version 2 preview' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Demo role' }).selectOption('founder');
  await page.goto('/founder/documents');
  await page.getByRole('button', { name: 'Preview handoff of v2' }).click();
  await page.getByRole('checkbox', { name: 'Founder intake.pdf' }).check();
  await page.getByRole('checkbox', { name: 'Cap table summary.xlsx' }).uncheck();
  await page.getByRole('checkbox', { name: 'Forecast assumptions.pdf' }).uncheck();
  await page.getByRole('button', { name: 'Confirm simulated handoff' }).click();
  await expect(page.getByRole('button', { name: 'Confirm simulated handoff' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Demo role' }).selectOption('advisor');
  await page.goto('/advisor/documents?advisor_demo=browser');
  await expect(page.getByRole('region', { name: 'Packet version 2 preview' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Packet version' }).selectOption({ label: 'v2 · Review required' });
  const versionId = await page.getByRole('combobox', { name: 'Packet version' }).inputValue();
  await page.goto(`/advisor/documents?version=${versionId}&source=00000000-0000-4000-8000-000000000011`);
  await expect(page.locator('.source-excerpt')).toContainText('$240,000');
  await page.goto(`/advisor/documents?version=${versionId}&source=00000000-0000-4000-8000-000000000013`);
  await expect(page.locator('.source-excerpt')).toHaveCount(0);
});
