import console from 'node:console';
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();const errors=[];const layouts=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
async function capture(name,path){
 await page.goto('http://127.0.0.1:5186'+path);await page.locator('main h1').waitFor();
 for(const width of [1440,1024,390]){
  await page.setViewportSize({width,height:width===390?844:1000});
  await page.screenshot({path:`screenshots/${name}-${width}.png`,fullPage:true});
  layouts.push({name,width,overflow:await page.evaluate(()=>globalThis.document.documentElement.scrollWidth>globalThis.innerWidth+1),heading:await page.locator('main h1').first().innerText()});
 }
}
await capture('client-home','/founder/home');await capture('client-chat','/founder/chat');
await capture('advisor-home','/advisor/home');await capture('advisor-clients','/advisor/clients');
await capture('client-pre-call','/founder/call');await capture('advisor-pre-call','/advisor/call');
await page.getByRole('button',{name:'Call Alex Morgan',exact:true}).click();
await page.getByRole('button',{name:'Cancel invite',exact:true}).waitFor();
await page.goto('http://127.0.0.1:5186/founder/call');await page.getByRole('button',{name:'Accept invitation',exact:true}).click();await page.getByRole('button',{name:'End call',exact:true}).waitFor();
await capture('client-active-call','/founder/call');await capture('advisor-active-call','/advisor/call');
await page.getByRole('button',{name:'End call',exact:true}).click();
console.log(JSON.stringify({errors,layouts},null,2));await browser.close();
if(errors.length||layouts.some(layout=>layout.overflow))throw new Error('Visual verification found console errors or horizontal overflow.');
