import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const routes = [
 ['founder-home','/founder/home'],['founder-chat','/founder/chat'],['advisor-home','/advisor/home'],['founder-sources','/founder/sources'],
 ['founder-documents','/founder/documents'],['founder-call','/founder/call'],
 ['founder-clarification','/founder/home/clarification'],
 ['advisor-clients','/advisor/clients'],['advisor-reviews','/advisor/reviews'],
 ['advisor-documents','/advisor/documents'],['advisor-call','/advisor/call'],
] as const;

async function prepareClarification(page:Page):Promise<void>{
 await page.goto('/advisor/reviews');
 await page.getByRole('button',{name:'Preview questions',exact:true}).click();
 await page.getByRole('button',{name:'Return review with these questions',exact:true}).click();
 await expect(page.getByRole('button',{name:'Return review with these questions',exact:true})).toHaveCount(0);
 await page.getByRole('combobox',{name:'Demo role'}).selectOption('founder');
 await page.getByRole('link',{name:'Answer clarification in chat',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Clarify packet details'})).toBeVisible();
}

for(const [name,route] of routes){
 test(`${name}: desktop, keyboard, responsive, empty and reconnect`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1600,height:1000});
  if(name==='founder-clarification')await prepareClarification(page);else await page.goto(route);
  await expect(page.locator('main h1').first()).toBeVisible();
  await expect(page.getByText('Screen implementation pending.')).toHaveCount(0);
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath(`${name}-desktop.png`),fullPage:true});
  const assets=await page.locator('img:visible').evaluateAll(images=>images.map(image=>({src:image.getAttribute('src'),ok:image instanceof HTMLImageElement&&image.complete&&image.naturalWidth>0,width:image.getBoundingClientRect().width,height:image.getBoundingClientRect().height})));
  expect(assets.every(asset=>asset.ok&&asset.width>0&&asset.height>0)).toBe(true);
  await page.keyboard.press('Tab');
  const focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,outline:document.activeElement?getComputedStyle(document.activeElement).outlineStyle:'none'}));
  expect(focus.tag).not.toBe('BODY');expect(focus.outline).not.toBe('none');
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('main h1').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.screenshot({path:test.info().outputPath(`${name}-mobile.png`),fullPage:true});
  await page.getByText('Test states',{exact:true}).click();
  await page.getByRole('combobox',{name:'Test scenario'}).selectOption('empty');
  if(name==='founder-home')await expect(page.getByText('No documents in this view yet.',{exact:true})).toBeVisible();
  else if(name==='founder-chat')await expect(page.getByText('Tasks will appear as your packet work begins.',{exact:true})).toBeVisible();
  else await expect(page.getByRole('heading').filter({hasText:/No |Your workspace is ready|Home conversation|Call/}).first()).toBeVisible();
  await page.getByRole('combobox',{name:'Test scenario'}).selectOption('error');
  await expect(page.getByRole('heading',{name:'Workspace unavailable'})).toBeVisible();
  await page.getByRole('combobox',{name:'Test scenario'}).selectOption('disconnected');
  await expect(page.getByRole('heading',{name:'Workspace unavailable'})).toBeVisible();
  await page.getByRole('button',{name:'Reconnect / refresh'}).click();
  await expect(page.locator('main h1').first()).toBeVisible();
  expect(errors).toEqual([]);
 });
}

test('returned questions create an unapproved version and require renewed handoff',async({page})=>{
 await prepareClarification(page);
 await expect(page.getByText('Maya Chen',{exact:true}).first()).toBeVisible();
 await page.getByRole('textbox',{name:'Answer Maya Chen’s question'}).fill('2026 revenue is $240,000. My reserve target is $60,000.');
 await page.getByRole('button',{name:'Preview answer',exact:true}).click();
 await page.evaluate(()=>{
  const state=window as Window & { relayWorkingSeen?:boolean };
  state.relayWorkingSeen=false;
  const observer=new MutationObserver(()=>{
   const visible=[...document.querySelectorAll('main .badge')].some(element=>element.textContent==='Thinking / Working'&&element.getClientRects().length>0);
   if(visible){state.relayWorkingSeen=true;observer.disconnect();}
  });
  observer.observe(document.body,{subtree:true,childList:true,characterData:true});
 });
 await page.getByRole('button',{name:'Create simulated draft v2',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as Window & { relayWorkingSeen?:boolean }).relayWorkingSeen)).toBe(true);
 await expect(page.getByRole('link',{name:'Review packet v2',exact:true})).toBeVisible();
 await page.goto('/founder/documents');
 await expect(page.getByRole('button',{name:'Preview handoff of v2',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Preview handoff of v2',exact:true}).click();
 await page.getByRole('button',{name:'Confirm simulated handoff',exact:true}).click();
 await expect(page.getByRole('button',{name:'Confirm simulated handoff',exact:true})).toHaveCount(0);
 await page.getByRole('combobox',{name:'Demo role'}).selectOption('advisor');
 await page.getByRole('link',{name:'Clients',exact:true}).click();
 await page.getByRole('button',{name:'Review approval of v2',exact:true}).click();
 await page.getByRole('button',{name:'Confirm simulated approval of v2',exact:true}).click();
 await expect(page.getByRole('button',{name:'Review approval of v2',exact:true})).toBeDisabled();
});

test('local attachment intake succeeds and slow sends can be cancelled',async({page})=>{
 await page.goto('/founder/home');
 await page.getByLabel('Attach a source').setInputFiles({name:'fictional.pdf',mimeType:'application/pdf',buffer:Buffer.from('synthetic fixture')});
 await expect(page.getByText('Selected locally: fictional.pdf')).toBeVisible();
 await page.getByRole('button',{name:'Add source locally'}).click();
 await expect(page.getByText(/Selected locally:/)).toHaveCount(0);
 await page.getByLabel('Attach a source').setInputFiles({name:'cancel-this.txt',mimeType:'text/plain',buffer:Buffer.from('cancel me')});
 await page.getByRole('button',{name:'Cancel attachment'}).click();
 await page.getByText('Test states',{exact:true}).click();
 await page.getByRole('link',{name:'AI Chat',exact:true}).click();
 await page.getByRole('combobox',{name:'Test scenario'}).selectOption('slow');
 await page.getByLabel('Message Relay',{exact:true}).fill('Cancelled message');
 await page.getByRole('button',{name:'Send to simulated AI'}).click();
 await page.getByRole('button',{name:'Cancel request'}).click();
 await expect(page.getByRole('alert')).toContainText('cancelled');
 await expect(page.locator('.message-bubble').filter({hasText:'Cancelled message'})).toHaveCount(0);
});

test('call invitation requires recipient acceptance and never creates capture or live media',async({page})=>{
 await page.goto('/founder/call');
 await expect(page.getByRole('heading',{name:'Ready to call?'})).toBeVisible();
 await expect(page.getByRole('checkbox')).toHaveCount(0);
 await page.getByRole('button',{name:'Call Maya Chen',exact:true}).click();
 await expect(page.getByText('Invitation pending',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Cancel invite',exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Demo role'}).selectOption('advisor');
 await page.getByRole('link',{name:'Call',exact:true}).click();
 await page.getByRole('button',{name:'Accept invitation',exact:true}).click();
 await expect(page.getByText('Connecting',{exact:true})).toBeVisible();
 await expect(page.getByText('Simulated call state. No audio or video connection is available.')).toBeVisible();
 await expect(page.locator('video,audio')).toHaveCount(0);
 await expect(page.getByRole('checkbox')).toHaveCount(0);
 await page.getByRole('button',{name:'End call',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Ready to call?'})).toBeVisible();
});

test('unsent drafts survive reconnect and stay scoped to role and audience',async({page})=>{
 await page.goto('/founder/chat');
 await page.getByLabel('Message Relay',{exact:true}).fill('Private unsent founder draft');
 await page.getByText('Test states',{exact:true}).click();
 await page.getByRole('combobox',{name:'Test scenario'}).selectOption('disconnected');
 await expect(page.getByRole('heading',{name:'Workspace unavailable'})).toBeVisible();
 await page.getByRole('button',{name:'Reconnect / refresh'}).click();
 await expect(page.getByLabel('Message Relay',{exact:true})).toHaveValue('Private unsent founder draft');
 await page.getByRole('combobox',{name:'Message audience'}).selectOption('human');
 await expect(page.getByLabel('Message Maya Chen',{exact:true})).toHaveValue('');
 await page.getByRole('combobox',{name:'Demo role'}).selectOption('advisor');
 await page.getByRole('link',{name:'Clients',exact:true}).click();
 await expect(page.getByLabel('Message Relay',{exact:true})).toHaveValue('');
});
