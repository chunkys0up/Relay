import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function sendPrivate(page:Page,text:string):Promise<void>{
 await page.getByLabel('Message Relay',{exact:true}).fill(text);
 await page.getByRole('button',{name:'Send to simulated AI',exact:true}).click();
 await expect(page.locator('.message-bubble').filter({hasText:text})).toHaveCount(1);
}

test('initial answer advances Home without advisor clarification and survives reload',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/founder/home');
 await sendPrivate(page,'2026 revenue is $240,000. My reserve target is $60,000.');
 await expect(page.getByText('Case status: Draft ready',{exact:true})).toBeVisible();
 await expect(page.getByText('0 need your input',{exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByText('Case status: Draft ready',{exact:true})).toBeVisible();
 await expect(page.locator('.message-bubble').filter({hasText:'My reserve target is $60,000.'})).toHaveCount(1);
 expect(errors).toEqual([]);
});

test('Home file intake stores actual content and remains visible after reload',async({page})=>{
 await page.goto('/founder/home');
 await page.getByLabel('Attach a source').setInputFiles({name:'local-intake.txt',mimeType:'text/plain',buffer:Buffer.from('Unique uploaded source evidence 4271')});
 await page.getByRole('button',{name:'Add source locally',exact:true}).click();
 await expect(page.getByText('Selected locally: local-intake.txt',{exact:true})).toHaveCount(0);
 await page.goto('/founder/sources?q=local-intake');
 await expect(page.getByText('local-intake.txt',{exact:true}).first()).toBeVisible();
 await expect(page.getByText(/Unique uploaded source evidence 4271/)).toBeVisible();
 await page.reload();
 await expect(page.getByText(/Unique uploaded source evidence 4271/)).toBeVisible();
});

test('separate tabs receive confirmed human messages, preserve privacy, and retain state on reload',async({page,context})=>{
 await page.goto('/founder/home');
 const advisor=await context.newPage();await advisor.goto('/advisor/clients');
 await expect(advisor.getByLabel('Message Relay',{exact:true})).toBeVisible();
 await sendPrivate(page,'Private founder marker 4271');
 await expect(advisor.locator('.message-bubble').filter({hasText:'Private founder marker 4271'})).toHaveCount(0);
 await page.getByRole('combobox',{name:'Message audience'}).selectOption('human');
 await advisor.getByRole('combobox',{name:'Message audience'}).selectOption('human');
 await page.getByLabel('Message Maya Chen',{exact:true}).fill('Shared founder marker 4271');
 await page.getByRole('button',{name:'Preview message',exact:true}).click();
 await expect(advisor.locator('.message-bubble').filter({hasText:'Shared founder marker 4271'})).toHaveCount(0);
 await page.getByRole('button',{name:'Confirm simulated send',exact:true}).click();
 await expect(advisor.locator('.message-bubble').filter({hasText:'Shared founder marker 4271'})).toHaveCount(1);
 await advisor.getByLabel('Message Alex Morgan',{exact:true}).fill('Advisor response marker 4271');
 await advisor.getByRole('button',{name:'Preview message',exact:true}).click();
 await advisor.getByRole('button',{name:'Confirm simulated send',exact:true}).click();
 await expect(page.locator('.message-bubble').filter({hasText:'Advisor response marker 4271'})).toHaveCount(1);
 await page.reload();await page.getByRole('combobox',{name:'Message audience'}).selectOption('human');
 await expect(page.locator('.message-bubble').filter({hasText:'Advisor response marker 4271'})).toHaveCount(1);
 await advisor.reload();await advisor.getByRole('combobox',{name:'Message audience'}).selectOption('human');
 await expect(advisor.locator('.message-bubble').filter({hasText:'Shared founder marker 4271'})).toHaveCount(1);
 await advisor.getByRole('combobox',{name:'Message audience'}).selectOption('private_ai');
 await expect(advisor.locator('.message-bubble').filter({hasText:'Private founder marker 4271'})).toHaveCount(0);
});

test('an initial private draft appears to a second founder tab but not the advisor until handoff',async({page,context})=>{
 await page.goto('/founder/home');
 const other=await context.newPage();await other.goto('/founder/home');
 const advisor=await context.newPage();await advisor.goto('/advisor/documents');
 await sendPrivate(page,'2026 revenue is $240,000. My reserve target is $60,000.');
 await expect(other.getByText('Case status: Draft ready',{exact:true})).toBeVisible();
 await expect(advisor.getByRole('region',{name:/Packet version 2 preview/})).toHaveCount(0);
 await page.goto('/founder/documents');
 await page.getByRole('button',{name:'Preview handoff of v2',exact:true}).click();
 await page.getByRole('button',{name:'Confirm simulated handoff',exact:true}).click();
 await expect(advisor.getByRole('region',{name:'Packet version 2 preview',exact:true})).toBeVisible();
});
