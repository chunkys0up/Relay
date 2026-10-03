import { test, expect } from './fixtures';

for (const role of ['founder', 'advisor']) {
  test(`${role}: Chime fits V2 pre-call and makes no request before joining`, async ({ page }) => {
    const errors: string[] = [];
    const calls: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('**/api/cases/**/calls**', async route => {
      calls.push(route.request().url());
      await route.abort();
    });
    await page.goto(`/${role}/call`);
    await page.getByRole('combobox', { name: 'Call connection' }).selectOption('live');
    await expect(page.getByRole('heading', { name: 'Ready to call?' })).toBeVisible();
    await expect(page.getByText('Already shared', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Call', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Start or join/ })).toBeVisible();
    if (role === 'advisor') await expect(page.getByText(/Review actions for v/)).toBeVisible();
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`chime-${role}-${width}.png`), fullPage: true });
    }
    await page.getByRole('combobox', { name: 'Call connection' }).selectOption('demo');
    await expect(page.getByRole('button', { name: role === 'founder' ? 'Call Maya Chen' : 'Call Alex Morgan', exact: true })).toBeVisible();
    expect(calls).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const role of ['founder', 'advisor']) {
  test(`${role}: mocked Chime lifecycle stays in the shared review layout`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const call = { id: 'test-call', case_id: 'test-case', state: 'connecting', participants: [], capture: 'off' };
    await page.route('**/api/cases/**/calls**', async route => {
      const path = route.request().url();
      await route.fulfill({ json: path.endsWith('/join') ? { call, meeting: {}, attendee: {} } : path.endsWith('/end') ? { ...call, state: 'ended' } : call });
    });
    // Test-only SDK substitute: no cloud connection or media-device permissions.
    await page.route('**/*amazon-chime-sdk-js*', async route => route.fulfill({ contentType: 'application/javascript', body: `
      export class NoOpLogger {}
      export class DefaultDeviceController { setDeviceLabelTrigger() {} }
      export class MeetingSessionConfiguration {}
      export class DefaultMeetingSession {
        constructor() {
          let observer;
          const connect = () => observer?.audioVideoDidStart();
          this.audioVideo = {
            addObserver: value => { observer = value; },
            removeObserver: () => { observer = null; window.removeEventListener('test-chime-connect', connect); },
            listAudioInputDevices: async () => [], listVideoInputDevices: async () => [],
            bindAudioElement: async () => {}, unbindAudioElement: () => {},
            start: () => window.addEventListener('test-chime-connect', connect), stop: () => {},
            stopLocalVideoTile: () => {}, stopAudioInput: async () => {}, stopVideoInput: async () => {}
          };
        }
      }
      export default { NoOpLogger, DefaultDeviceController, MeetingSessionConfiguration, DefaultMeetingSession };
    ` }));
    await page.goto(`/${role}/call`);
    await page.getByRole('combobox', { name: 'Call connection' }).selectOption('live');
    await page.getByRole('button', { name: 'Start or join live call', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Review with/ })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Call connection' })).toBeDisabled();
    await expect(page.getByText('Connecting', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Messages', exact: true })).toBeVisible();
    await expect(page.getByText('No microphone is available. You can join and listen.', { exact: true })).toBeVisible();
    await expect(page.getByText('Connected', { exact: true })).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('test-chime-connect')));
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Turn camera on', exact: true })).toBeEnabled();
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`chime-${role}-active-mocked-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: 'End for everyone', exact: true }).click();
    await expect(page.getByText('The call ended for everyone.', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Call connection' })).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'Call', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
