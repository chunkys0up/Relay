import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

execFileSync('backend/.venv/bin/python', ['backend/tests/make_browser_fixtures.py', '--output-dir', 'test-results/packet-sources']);

test('normal mode starts empty, creates a server case and retains it across reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/founder/home');
  await expect(page.getByRole('heading', { name: 'No packet cases yet' })).toBeVisible();
  await page.getByLabel('Company', { exact: true }).fill('Packet persistence acceptance');
  await page.getByLabel('Planning goal', { exact: true }).fill('Verify actual stored source and packet records');
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Packet persistence acceptance', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Packet persistence acceptance', exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/workflow/cases');
    return { status: response.status, body: await response.json() as { items: { company: string }[] } };
  });
  expect(result.status).toBe(200);
  expect(result.body.items.map(item => item.company)).toEqual(['Packet persistence acceptance']);
  const original = readFileSync('test-results/packet-sources/relay-workflow-source.pdf');
  await page.getByLabel('Upload original source').setInputFiles({
    name: 'acceptance-original.pdf', mimeType: 'application/pdf', buffer: original,
  });
  await expect(page.getByRole('link', { name: 'acceptance-original.pdf', exact: true })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const cases = await (await fetch('/api/workflow/cases')).json() as { items: { id: string }[] };
    const state = await (await fetch('/api/workflow/cases/' + cases.items[0].id)).json() as {
      sources: { id: string; hash: string }[]; id: string;
    };
    return state;
  });
  expect(saved.sources).toHaveLength(1);
  expect(saved.sources[0].hash).toBe(createHash('sha256').update(original).digest('hex'));
  const stored = await page.request.get('/api/workflow/cases/' + saved.id + '/sources/' + saved.sources[0].id + '/preview');
  expect(stored.ok()).toBe(true);
  expect(await stored.body()).toEqual(original);
  await page.reload();
  await expect(page.getByRole('link', { name: 'acceptance-original.pdf', exact: true })).toBeVisible();
  await page.getByLabel('Import packet PDF', { exact: true }).setInputFiles({
    name: 'acceptance-packet.pdf', mimeType: 'application/pdf', buffer: original,
  });
  await expect(page.getByRole('link', { name: /acceptance-packet.pdf v1/ })).toBeVisible();
  await page.getByRole('link', { name: /acceptance-packet.pdf v1/ }).click();
  await expect(page.getByRole('button', { name: 'Move to review stage', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Move to review stage', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm stage change', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Move to review stage', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('In review', { exact: true }).first()).toBeVisible();
  const packetState = await page.evaluate(async (caseId: string) => {
    const response = await fetch('/api/workflow/cases/' + caseId);
    return await response.json() as { revision: number; packets: { id: string; hash: string; stage: string; stage_events: unknown[] }[] };
  }, saved.id);
  expect(packetState.packets).toHaveLength(1);
  expect(packetState.packets[0].stage).toBe('in_review');
  expect(packetState.packets[0].stage_events).toHaveLength(1);
  expect(packetState.packets[0].hash).toBe(createHash('sha256').update(original).digest('hex'));
  const packetResponse = await page.request.get('/api/workflow/cases/' + saved.id + '/packets/' + packetState.packets[0].id + '/download');
  expect(packetResponse.ok()).toBe(true);
  expect(await packetResponse.body()).toEqual(original);
  await page.screenshot({ path: 'test-results/packet-stage-persisted.png', fullPage: true });
  expect(errors).toEqual([]);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

test('normal mode reports a missing backend without seeding browser fixture packets', async ({ page }) => {
  await page.route('**/api/workflow/**', route => route.fulfill({
    status: 503, contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'BACKEND_UNAVAILABLE' } }),
  }));
  await page.goto('/founder/home');
  await expect(page.getByRole('alert').first()).toContainText(/unavailable|could not|stopped/i);
  await expect(page.getByText('Northstar Labs', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Founder planning packet', { exact: true })).toHaveCount(0);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

test('example PDFs are stored once and their four stages survive case selection and reload', async ({ page }) => {
  await page.goto('/founder/home');
  await page.getByRole('button', { name: 'Load example packet cases', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cedar Studio', exact: true })).toBeVisible();
  const cases = await page.evaluate(async () => (await (await fetch('/api/workflow/cases')).json()).items as { id: string; company: string; packets: { stage: string }[] }[]);
  expect(cases).toHaveLength(4);
  const expected = new Map([['Cedar Studio', 'draft'], ['Harbor Analytics', 'in_review'], ['Juniper Foods', 'questions_returned'], ['Summit Design', 'approved']]);
  for (const item of cases) {
    await page.getByLabel('Packet case', { exact: true }).selectOption(item.id);
    await expect(page.getByRole('heading', { name: item.company, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: item.company, exact: true })).toBeVisible();
    const state = await page.evaluate(async id => (await (await fetch('/api/workflow/cases/' + id)).json()), item.id);
    expect(state.packets[0].stage).toBe(expected.get(item.company));
    expect(state.sources).toHaveLength(1);
    expect(state.packets).toHaveLength(1);
    const pdf = await page.request.get('/api/workflow/cases/' + item.id + '/packets/' + state.packets[0].id + '/download');
    expect(createHash('sha256').update(await pdf.body()).digest('hex')).toBe(state.packets[0].hash);
  }
  await page.getByRole('button', { name: 'Load example packet cases', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cedar Studio', exact: true })).toBeVisible();
  const repeated = await page.evaluate(async () => (await (await fetch('/api/workflow/cases')).json()).items as { id: string }[]);
  expect(repeated.map(item => item.id).sort()).toEqual(cases.map(item => item.id).sort());
  await page.screenshot({ path: 'test-results/example-packets-persisted.png', fullPage: true });
});

test('separate advisor session accepts an exact packet invite, reviews it, and loses access on revocation', async ({ browser }) => {
  const founderContext=await browser.newContext();
  const advisorContext=await browser.newContext();
  const founder=await founderContext.newPage();
  const advisor=await advisorContext.newPage();
  try {
    await founder.goto('/founder/home');
    await founder.getByLabel('Company',{exact:true}).fill('Shared Review Studio');
    await founder.getByLabel('Planning goal',{exact:true}).fill('Review one exact PDF');
    await founder.getByRole('button',{name:'Create case',exact:true}).click();
    await expect(founder.getByRole('heading',{name:'Shared Review Studio',exact:true})).toBeVisible();
    const original=readFileSync('test-results/packet-sources/relay-workflow-source.pdf');
    await founder.getByLabel('Import packet PDF',{exact:true}).setInputFiles({name:'shared-packet.pdf',mimeType:'application/pdf',buffer:original});
    await founder.getByRole('link',{name:/shared-packet.pdf v1/}).click();
    await founder.getByRole('button',{name:'Move to review stage'}).click();
    await founder.getByRole('button',{name:'Confirm stage change'}).click();
    await expect(founder.getByRole('button',{name:'Create invitation'})).toBeVisible();
    await founder.getByRole('button',{name:'Create invitation'}).click();
    const invitation=founder.getByText(/Invitation code:/);
    await expect(invitation).toBeVisible();
    const code=(await invitation.locator('code').textContent())?.trim();
    expect(code).toBeTruthy();
    const founderState=await founder.evaluate(async()=>{
      const cases=await (await fetch('/api/workflow/cases')).json() as {items:{id:string}[]};
      return (await (await fetch('/api/workflow/cases/'+cases.items[0].id)).json()) as
        {id:string;revision:number;packets:{id:string;hash:string;stage:string}[]};
    });
    await founder.goto('/advisor/home');
    await expect(founder.getByRole('heading',{name:'Accept a packet invitation'})).toBeVisible();
    await expect(founder.getByText('Shared Review Studio')).toHaveCount(0);
    await advisor.goto('/advisor/home');
    await expect(advisor.getByRole('heading',{name:'Accept a packet invitation'})).toBeVisible();
    await advisor.getByLabel('Invitation code').fill(code!);
    await advisor.getByRole('button',{name:'Accept invitation'}).click();
    await expect(advisor.getByText('Shared Review Studio').first()).toBeVisible();
    await advisor.goto('/advisor/documents');
    await expect(advisor.getByRole('button',{name:'Approve version'})).toBeVisible();
    const advisorPacket=await advisor.request.get(`/api/workflow/cases/${founderState.id}/packets/${founderState.packets[0].id}/download`);
    expect(advisorPacket.status()).toBe(200);
    expect(await advisorPacket.body()).toEqual(original);
    await advisor.getByRole('button',{name:'Approve version'}).click();
    await advisor.getByRole('button',{name:'Confirm review'}).click();
    await expect(advisor.getByText('Approved',{exact:true}).first()).toBeVisible();
    await founder.goto('/founder/documents');
    await expect(founder.getByText('Approved',{exact:true}).first()).toBeVisible();
    const reviewed=await founder.evaluate(async id=>(await (await fetch('/api/workflow/cases/'+id)).json()) as
      {packets:{id:string;hash:string;stage:string}[];reviews:{packet_id:string;packet_hash:string;decision:string}[]},founderState.id);
    expect(reviewed.packets[0].stage).toBe('approved');
    expect(reviewed.reviews[0]).toMatchObject({packet_id:founderState.packets[0].id,packet_hash:founderState.packets[0].hash,decision:'approved'});
    await founder.getByRole('button',{name:'Revoke'}).click();
    await advisor.reload();
    await expect(advisor.getByRole('heading',{name:'Accept a packet invitation'})).toBeVisible();
    expect((await advisor.request.get(`/api/workflow/cases/${founderState.id}`)).status()).toBe(404);
  } finally {
    await founderContext.close();
    await advisorContext.close();
  }
});
