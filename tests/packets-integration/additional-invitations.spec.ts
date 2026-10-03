import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

execFileSync('backend/.venv/bin/python', ['backend/tests/make_browser_fixtures.py',
  '--output-dir', 'test-results/additional-invitation-sources']);
const pdf=readFileSync('test-results/additional-invitation-sources/relay-workflow-source.pdf');

interface SharedCase { id:string; company:string; current_packet_id:string; packets:{id:string;hash:string}[]; sources:{id:string}[] }
async function caseByCompany(page:Page,company:string):Promise<SharedCase> {
  return page.evaluate(async(name:string)=>{
    const response=await fetch('/api/workflow/cases');
    const data=await response.json() as {items:SharedCase[]};
    const found=data.items.find(item=>item.company===name);
    if(!found)throw new Error(`Missing case ${name}`);
    return found;
  },company);
}

async function prepareInvitation(founder:Page,company:string,first:boolean):Promise<{code:string;state:SharedCase}> {
  await founder.goto('/founder/home');
  if(!first)await founder.getByText('Create another case',{exact:true}).click();
  await founder.getByLabel('Company',{exact:true}).fill(company);
  await founder.getByLabel('Planning goal',{exact:true}).fill('Check two independent packet grants');
  await founder.getByRole('button',{name:'Create case',exact:true}).click();
  await expect(founder.getByRole('heading',{name:company,exact:true})).toBeVisible();
  await founder.getByLabel('Upload original source',{exact:true}).setInputFiles({name:`${company}-source.pdf`,mimeType:'application/pdf',buffer:pdf});
  await expect(founder.getByRole('link',{name:`${company}-source.pdf`,exact:true})).toBeVisible();
  await founder.getByLabel('Import packet PDF',{exact:true}).setInputFiles({name:`${company}-packet.pdf`,mimeType:'application/pdf',buffer:pdf});
  await founder.getByRole('link',{name:new RegExp(`${company}-packet.pdf v1`)}).click();
  await founder.getByRole('button',{name:'Move to review stage',exact:true}).click();
  await founder.getByRole('button',{name:'Confirm stage change',exact:true}).click();
  const state=await caseByCompany(founder,company);
  await founder.getByRole('checkbox',{name:`${company}-source.pdf`}).check();
  await founder.getByRole('button',{name:'Create invitation',exact:true}).click();
  const invitation=founder.getByText(/Invitation code:/);
  await expect(invitation).toBeVisible();
  const code=(await invitation.locator('code').textContent())?.trim();
  expect(code).toBeTruthy();
  return {code:code!,state};
}

test('an existing advisor accepts a second case while retaining the first exact grant',async({browser})=>{
  const founderContext=await browser.newContext();
  const advisorContext=await browser.newContext();
  const strangerContext=await browser.newContext();
  const founder=await founderContext.newPage();
  const advisor=await advisorContext.newPage();
  const stranger=await strangerContext.newPage();
  try{
    const first=await prepareInvitation(founder,'Harbor Additional',true);
    await advisor.goto('/advisor/home');
    await advisor.getByLabel('Invitation code',{exact:true}).fill(first.code);
    await advisor.getByRole('button',{name:'Accept invitation',exact:true}).click();
    await expect(advisor.getByRole('cell',{name:'Harbor Additional'})).toBeVisible();
    const second=await prepareInvitation(founder,'Cedar Additional',false);
    await advisor.goto('/advisor/home');
    await expect(advisor.getByRole('cell',{name:'Harbor Additional'})).toBeVisible();
    await advisor.getByLabel('Invitation code',{exact:true}).fill(second.code);
    await advisor.getByRole('button',{name:'Accept invitation',exact:true}).click();
    await expect(advisor.getByRole('cell',{name:'Cedar Additional'})).toBeVisible();
    await expect(advisor.getByRole('cell',{name:'Harbor Additional'})).toBeVisible();
    await expect(advisor.getByText('2 shared cases')).toBeVisible();
    await expect(advisor.getByLabel('Packet case',{exact:true})).toHaveValue(second.state.id);
    for(const item of [first,second]){
      expect((await advisor.request.get(`/api/workflow/cases/${item.state.id}`)).status()).toBe(200);
      expect((await advisor.request.get(`/api/workflow/cases/${item.state.id}/packets/${item.state.current_packet_id}/download`)).status()).toBe(200);
      expect((await advisor.request.get(`/api/workflow/cases/${item.state.id}/sources/${item.state.sources[0].id}/preview`)).status()).toBe(200);
    }
    await stranger.goto('/advisor/home');
    expect((await stranger.request.get('/api/workflow/session')).status()).toBe(200);
    expect((await stranger.request.get(`/api/workflow/cases/${first.state.id}`)).status()).toBe(404);
    expect((await stranger.request.get(`/api/workflow/cases/${second.state.id}`)).status()).toBe(404);
    await advisor.getByRole('row').filter({hasText:'Harbor Additional'}).getByRole('link',{name:'Open shared case'}).click();
    await expect(advisor.getByRole('heading',{name:'Harbor Additional',exact:true})).toBeVisible();
  }finally{
    await founderContext.close();
    await advisorContext.close();
    await strangerContext.close();
  }
});
