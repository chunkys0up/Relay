import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import type { RelayAdapter } from '../../frontend-shared/src/types';

async function sendPrivate(page:Page,text:string):Promise<void>{
 await page.getByLabel('Message Relay',{exact:true}).fill(text);
 await page.getByRole('button',{name:'Send',exact:true}).click();
 await expect(page.locator('.message-bubble').filter({hasText:text})).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible();
}

test('initial answer advances Home without advisor clarification and survives reload',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/founder/chat');
 await sendPrivate(page,'2026 revenue is $240,000. My reserve target is $60,000.');
 await expect(page.locator('.chat-page-case').getByText('Draft ready',{exact:true})).toBeVisible();
 // Local packet tasks and the server checklist are separate stores.
 const tasks=await page.evaluate(async()=>{
  const path='/src/persistence.ts';
  const module=await import(/* @vite-ignore */ path) as {createBrowserRelayAdapter:(latency?:number)=>RelayAdapter};
  return (await module.createBrowserRelayAdapter(0).snapshot('founder')).data.tasks;
 });
 expect(tasks.filter(task=>task.state==='Blocked')).toHaveLength(0);
 expect(tasks.filter(task=>task.state==='Done')).toHaveLength(4);
 await expect(page.getByText('Relay adds items here as you talk through your packet.',{exact:true})).toBeVisible();
 await page.reload();
 await expect(page.locator('.chat-page-case').getByText('Draft ready',{exact:true})).toBeVisible();
 await expect(page.locator('.message-bubble').filter({hasText:'My reserve target is $60,000.'})).toHaveCount(1);
 expect(errors).toEqual([]);
});

test('Home uploads actual content to the document API and reloads its saved listing',async({page,documentsApi})=>{
 await page.goto('/founder/home');
 await page.getByLabel('Upload documents',{exact:true}).setInputFiles({name:'backend-intake.txt',mimeType:'text/plain',buffer:Buffer.from('Unique uploaded source evidence 4271')});
 await expect.poll(()=>documentsApi.uploads.length).toBe(1);
 expect(documentsApi.uploads[0].filename).toBe('backend-intake.txt');
 expect(documentsApi.uploads[0].content.toString()).toBe('Unique uploaded source evidence 4271');
 await expect(page.getByRole('button',{name:'backend-intake.txt',exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByRole('button',{name:'backend-intake.txt',exact:true})).toBeVisible();
 const opened=page.waitForEvent('popup');
 await page.getByRole('button',{name:'backend-intake.txt',exact:true}).click();
 const preview=await opened;
 await expect(preview).toHaveURL(/\/api\/documents\/[^/]+\/preview$/);
 await expect(preview.locator('body')).toHaveText('Unique uploaded source evidence 4271');
 // Backend upload must not invent a source in the separate synthetic case.
 await page.goto('/founder/sources?q=backend-intake');
 await expect(page.getByRole('heading',{name:'No sources match this search'})).toBeVisible();
});

test('separate tabs receive confirmed human messages, preserve privacy, and retain state on reload',async({page,context})=>{
 await page.goto('/founder/chat');
 const advisor=await context.newPage();await advisor.goto('/advisor/clients');
 await expect(advisor.getByLabel('Message Relay',{exact:true})).toBeVisible();
 await sendPrivate(page,'Private founder marker 4271');
 await expect(advisor.locator('.message-bubble').filter({hasText:'Private founder marker 4271'})).toHaveCount(0);
 await page.getByRole('tab',{name:'Maya Chen',exact:true}).click();
 await advisor.goto('/advisor/documents?audience=human');
 await page.getByLabel('Message Maya Chen',{exact:true}).fill('Shared founder marker 4271');
 await page.getByRole('button',{name:'Preview message',exact:true}).click();
 await expect(advisor.locator('.message-bubble').filter({hasText:'Shared founder marker 4271'})).toHaveCount(0);
 await page.getByRole('button',{name:'Confirm simulated send',exact:true}).click();
 await expect(advisor.locator('.message-bubble').filter({hasText:'Shared founder marker 4271'})).toHaveCount(1);
 await advisor.getByLabel('Message Alex Morgan',{exact:true}).fill('Advisor response marker 4271');
 await advisor.getByRole('button',{name:'Preview message',exact:true}).click();
 await advisor.getByRole('button',{name:'Confirm simulated send',exact:true}).click();
 await expect(page.locator('.message-bubble').filter({hasText:'Advisor response marker 4271'})).toHaveCount(1);
 await page.reload();await page.getByRole('tab',{name:'Maya Chen',exact:true}).click();
 await expect(page.locator('.message-bubble').filter({hasText:'Advisor response marker 4271'})).toHaveCount(1);
 await advisor.reload();await advisor.goto('/advisor/documents?audience=human');
 await expect(advisor.locator('.message-bubble').filter({hasText:'Shared founder marker 4271'})).toHaveCount(1);
 await advisor.getByRole('tab',{name:'AI assistant',exact:true}).click();
 await expect(advisor.locator('.message-bubble').filter({hasText:'Private founder marker 4271'})).toHaveCount(0);
});

test('an initial private draft appears to a second founder tab but not the advisor until handoff',async({page,context})=>{
 await page.goto('/founder/chat');
 const other=await context.newPage();await other.goto('/founder/chat');
 const advisor=await context.newPage();await advisor.goto('/advisor/documents');
 await sendPrivate(page,'2026 revenue is $240,000. My reserve target is $60,000.');
 await expect(other.locator('.chat-page-case').getByText('Draft ready',{exact:true})).toBeVisible();
 await expect(advisor.getByRole('region',{name:/Packet version 2 preview/})).toHaveCount(0);
 await page.goto('/founder/documents');
 await page.getByRole('button',{name:'Preview handoff of v2',exact:true}).click();
 await page.getByRole('button',{name:'Confirm simulated handoff',exact:true}).click();
 await expect(advisor.getByRole('region',{name:'Packet version 2 preview',exact:true})).toBeVisible();
});
