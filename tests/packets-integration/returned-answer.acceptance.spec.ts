import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

execFileSync('backend/.venv/bin/python', ['backend/tests/make_browser_fixtures.py', '--output-dir', 'test-results/answer-sources']);
interface PacketState { id: string; hash: string; stage: string; version: number }
interface CaseState { id: string; current_packet_id: string; packets: PacketState[]; reviews: { id: string; note: string; packet_id: string; packet_hash: string }[] }
async function readCase(page: Page): Promise<CaseState> {
  return page.evaluate(async () => {
    const cases = await (await fetch('/api/workflow/cases')).json() as { items: { id: string }[] };
    return await (await fetch('/api/workflow/cases/' + cases.items[0].id)).json() as CaseState;
  });
}
async function invite(founder: Page, advisor: Page): Promise<void> {
  await founder.getByRole('button', { name: 'Create invitation', exact: true }).click();
  const invitation = founder.getByText(/Invitation code:/);
  await expect(invitation).toBeVisible();
  const code = (await invitation.locator('code').textContent())?.trim();
  expect(code).toBeTruthy();
  await advisor.goto('/advisor/home');
  await advisor.getByLabel('Invitation code', { exact: true }).fill(code!);
  await advisor.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await advisor.goto('/advisor/documents');
  await expect(advisor.getByRole('button', { name: 'Return questions', exact: true })).toBeVisible();
}

test('returned question produces a private immutable answer version and requires fresh sharing', async ({ browser }) => {
  const founderContext = await browser.newContext();
  const advisorContext = await browser.newContext();
  const founder = await founderContext.newPage();
  const advisor = await advisorContext.newPage();
  try {
    await founder.goto('/founder/home');
    await founder.getByLabel('Company', { exact: true }).fill('Answer Loop Studio');
    await founder.getByLabel('Planning goal', { exact: true }).fill('Verify returned questions and fresh version grants');
    await founder.getByRole('button', { name: 'Create case', exact: true }).click();
    await expect(founder.getByRole('heading', { name: 'Answer Loop Studio', exact: true })).toBeVisible();
    const original = readFileSync('test-results/answer-sources/relay-workflow-source.pdf');
    await founder.getByLabel('Import packet PDF', { exact: true }).setInputFiles({ name: 'answer-loop.pdf', mimeType: 'application/pdf', buffer: original });
    await founder.getByRole('link', { name: /answer-loop.pdf v1/ }).click();
    await founder.getByRole('button', { name: 'Move to review stage', exact: true }).click();
    await founder.getByRole('button', { name: 'Confirm stage change', exact: true }).click();
    const before = await readCase(founder);
    const oldPacket = before.packets[0];
    await invite(founder, advisor);
    const question = 'Please explain the timing of the planned equipment purchase.';
    await advisor.getByLabel('Review note', { exact: true }).fill(question);
    await advisor.getByRole('button', { name: 'Return questions', exact: true }).click();
    await advisor.getByRole('button', { name: 'Confirm review', exact: true }).click();
    await expect(advisor.getByText('Questions returned', { exact: true }).first()).toBeVisible();
    await founder.reload();
    await expect(founder.getByText(question, { exact: true }).first()).toBeVisible();
    await expect(founder.getByRole('button', { name: 'Move to review stage', exact: true })).toHaveCount(0);
    // Remaining actions follow the finalized user-facing answer controls.
    const answer = 'The fictional equipment purchase is planned for December after the client contract renews.';
    await founder.getByLabel('Founder answer', { exact: true }).fill(answer);
    await founder.getByRole('button', { name: 'Preview answer version', exact: true }).click();
    await expect(founder.getByRole('link', { name: 'Preview proposed PDF', exact: true })).toBeVisible();
    expect((await readCase(founder)).packets).toHaveLength(1);
    const discardedUrl = await founder.getByRole('link', { name: 'Preview proposed PDF', exact: true }).getAttribute('href');
    expect(discardedUrl).toBeTruthy();
    await founder.getByRole('button', { name: 'Discard preview', exact: true }).click();
    await expect(founder.getByRole('button', { name: 'Confirm answer and new version', exact: true })).toHaveCount(0);
    expect((await founder.request.get(discardedUrl!)).status()).toBe(404);
    await founder.getByRole('button', { name: 'Preview answer version', exact: true }).click();
    await expect(founder.getByRole('link', { name: 'Preview proposed PDF', exact: true })).toBeVisible();
    await founder.getByRole('button', { name: 'Confirm answer and new version', exact: true }).click();
    await expect.poll(async () => (await readCase(founder)).packets.length).toBe(2);
    const savedVersion = (await readCase(founder)).current_packet_id;
    await expect(founder).toHaveURL(new RegExp(savedVersion));
    await founder.reload();
    const after = await readCase(founder);
    expect(after.packets).toHaveLength(2);
    const next = after.packets.find(packet => packet.id === after.current_packet_id)!;
    expect(next).toMatchObject({ stage: 'draft', version: 2 });
    expect(next.hash).not.toBe(oldPacket.hash);
    expect(after.packets.find(packet => packet.id === oldPacket.id)).toMatchObject({ hash: oldPacket.hash, stage: 'questions_returned' });
    const oldBytes = await founder.request.get(`/api/workflow/cases/${after.id}/packets/${oldPacket.id}/download`);
    expect(await oldBytes.body()).toEqual(original);
    const newBytes = await founder.request.get(`/api/workflow/cases/${after.id}/packets/${next.id}/download`);
    expect(createHash('sha256').update(await newBytes.body()).digest('hex')).toBe(next.hash);
    const text = await founder.request.get(`/api/workflow/cases/${after.id}/packets/${next.id}/preview-text`);
    expect(await text.text()).toContain(answer);
    expect((await advisor.request.get(`/api/workflow/cases/${after.id}/packets/${next.id}/download`)).status()).toBe(404);
    await founder.getByRole('button', { name: 'Move to review stage', exact: true }).click();
    await founder.getByRole('button', { name: 'Confirm stage change', exact: true }).click();
    await invite(founder, advisor);
    await advisor.getByRole('button', { name: 'Approve version', exact: true }).click();
    await advisor.getByRole('button', { name: 'Confirm review', exact: true }).click();
    await advisor.reload();
    await expect(advisor.getByText('Approved', { exact: true }).first()).toBeVisible();
    await founder.reload();
    expect((await readCase(founder)).packets.find(packet => packet.id === next.id)?.stage).toBe('approved');
    await expect(founder.getByText('Approved', { exact: true }).first()).toBeVisible();
    await founder.screenshot({ path: 'test-results/returned-answer-approved.png', fullPage: true });
  } finally {
    await founderContext.close();
    await advisorContext.close();
  }
});