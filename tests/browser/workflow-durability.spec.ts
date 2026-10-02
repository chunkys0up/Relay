import { test, expect } from '@playwright/test';
import type { RelayAdapter } from '../../frontend-shared/src/types';

test('durable adapter rejects competing stale writes and remembers retry keys after reload',async({page,context})=>{
 await page.goto('/founder/home');await expect(page.getByLabel('Message Relay',{exact:true})).toBeVisible();
 const other=await context.newPage();await other.goto('/founder/home');await expect(other.getByLabel('Message Relay',{exact:true})).toBeVisible();
 const submit=async(tab:typeof page,key:string):Promise<string>=>tab.evaluate(async(key)=>{
  const path='/frontend-shared/src/persistence.ts';
  const module=await import(/* @vite-ignore */ path) as {createBrowserRelayAdapter:(latency?:number)=>RelayAdapter};
  const api=module.createBrowserRelayAdapter(0);
  try{await api.mutate('founder',{kind:'message',expected_revision:1,audience:{kind:'private_ai'},text:'Concurrent '+key,attachments:[],confirmed:false},{key});return 'ok';}
  catch(e:unknown){return (e as {code:string}).code;}
 },key);
 const results=await Promise.all([submit(page,'left'),submit(other,'right')]);
 expect(results.sort()).toEqual(['STALE_REVISION','ok']);
 // Read the winning stored text rather than relying on the now sorted result array.
 const stored=await page.evaluate(async()=>{
  const path='/frontend-shared/src/persistence.ts';const module=await import(/* @vite-ignore */ path) as {createBrowserRelayAdapter:(latency?:number)=>RelayAdapter};
  return (await module.createBrowserRelayAdapter(0).snapshot('founder')).data.messages.find(m=>m.text.startsWith('Concurrent '))!.text;
 });
 await page.reload();await expect(page.getByLabel('Message Relay',{exact:true})).toBeVisible();
 expect(await submit(page,stored.replace('Concurrent ',''))).toBe('ok');
 await expect(page.locator('.message-bubble').filter({hasText:stored})).toHaveCount(1);
});

test('reloading during draft preparation recovers exactly one completed draft',async({page})=>{
 await page.goto('/founder/home');
 await page.getByLabel('Message Relay',{exact:true}).fill('2026 revenue is $240,000. My reserve target is $60,000.');
 await page.getByRole('button',{name:'Send to simulated AI',exact:true}).click();
 await expect(page.getByLabel('Relay status').getByText('Thinking / Working',{exact:true})).toHaveAttribute('aria-current','step');
 await page.reload();
 await expect(page.getByText('Case status: Draft ready',{exact:true})).toBeVisible();
 const versions=await page.evaluate(async()=>{
  const path='/frontend-shared/src/persistence.ts';const module=await import(/* @vite-ignore */ path) as {createBrowserRelayAdapter:(latency?:number)=>RelayAdapter};
  return (await module.createBrowserRelayAdapter(0).snapshot('founder')).data.packets.map(p=>p.version);
 });
 expect(versions).toEqual([1,2]);
});
