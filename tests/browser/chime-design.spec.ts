import { test, expect } from './fixtures';

for (const role of ['founder', 'advisor'] as const) {
  test(`${role}: pre-call controls stay on the shared document and do not contact Chime`, async ({ page }) => {
    const calls: string[] = [];
    await page.route('**/api/cases/**/calls**', async route => { calls.push(route.request().url()); await route.abort(); });
    await page.goto(`/${role}/call`);
    if (role === 'founder') await page.getByRole('tab', { name: 'Call', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ready to call?' })).toBeVisible();
    await expect(page.getByText('Already shared', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start or join live call' })).toBeVisible();
    await page.getByRole('tab', { name: 'Packet summary', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Packet version 1 preview' })).toBeVisible();
    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    expect(calls).toEqual([]);
  });

  test(`${role}: a mocked Chime call can connect and end in the review layout`, async ({ page }) => {
    const call = { id: 'test-call', case_id: 'test-case', state: 'connecting', participants: [], capture: 'off' };
    await page.route('**/api/cases/**/calls**', route => {
      const path = route.request().url();
      return route.fulfill({ json: path.endsWith('/join') ? { call, meeting: {}, attendee: {} } : path.endsWith('/end') ? { ...call, state: 'ended' } : call });
    });
    await page.route('**/*amazon-chime-sdk-js*', route => route.fulfill({ contentType: 'application/javascript', body: `
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
    if (role === 'founder') await page.getByRole('tab', { name: 'Call', exact: true }).click();
    await page.getByRole('button', { name: 'Start or join live call' }).click();
    await expect(page.getByText('Connecting', { exact: true })).toBeVisible();
    await expect(page.getByText('No microphone is available. You can join and listen.')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('test-chime-connect')));
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mute microphone' })).toBeDisabled();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const cards = await page.locator('.relay-call-person').evaluateAll(elements => elements.map(element => {
        const card = element.getBoundingClientRect();
        const name = element.querySelector('strong')!.getBoundingClientRect();
        const media = element.querySelector('.relay-call-media')!.getBoundingClientRect();
        return { contained: name.left >= card.left && name.right <= card.right,
          separateRows: name.top >= media.bottom - 1 };
      }));
      expect(cards).toHaveLength(2);
      expect(cards.every(card => card.contained && card.separateRows)).toBe(true);
    }
    await page.getByRole('button', { name: 'End for everyone' }).click();
    await expect(page.getByText('The call ended for everyone.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ready to call?' })).toBeVisible();
  });
}
