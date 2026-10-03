import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const sourceNames = ['Founder intake.pdf', 'Cap table summary.xlsx', 'Forecast assumptions.pdf'] as const;
const sourceIds = ['00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000013'] as const;
const packetName = 'Founder planning packet';
const routes = [
  ['/founder/chat','AI Chat',false], ['/founder/sources','Sources',false],
  ['/founder/documents','Documents',false], ['/founder/call','Call',true],
  ['/advisor/clients','Clients',false], ['/advisor/reviews','Reviews',false],
  ['/advisor/documents','Documents',false], ['/advisor/call','Call',true],
] as const;

async function go(page:Page,path:string):Promise<void>{
  await page.goto(path === '/advisor/documents' ? path + '?advisor_demo=browser' : path);
  await expect(page.locator('main h1').first()).toBeVisible();
}
async function navigate(page:Page,label:string):Promise<void>{
  if(['Sources','Documents','Reviews'].includes(label)){const role=new URL(page.url()).pathname.startsWith('/advisor')?'advisor':'founder';await go(page,`/${role}/${label.toLowerCase()}`);return;}
  await page.locator('.navigation').getByRole('link',{name:label,exact:true}).click();
}
async function scenario(page:Page,value:string):Promise<void>{
  const menu=page.locator('.scenario-menu');
  if(!(await menu.getByRole('combobox',{name:'Test scenario'}).isVisible()))await menu.locator('summary').click();
  await page.getByRole('combobox',{name:'Test scenario'}).selectOption(value);
}
async function switchRole(page:Page,role:'founder'|'advisor'):Promise<void>{
  await page.getByRole('combobox',{name:'Demo role'}).selectOption(role);
  await expect(page.locator('main h1').first()).toBeVisible();
}
async function sendQuestion(page:Page,mode:'return'|'send'='return'):Promise<void>{
  await go(page,'/advisor/reviews');
  await page.getByRole('button',{name:'Preview questions',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Question preview'})).toBeVisible();
  await page.getByRole('button',{name:mode==='return'?'Return review with these questions':'Confirm simulated send',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Question preview'})).toHaveCount(0);
}
async function createV2(page:Page):Promise<void>{
  await sendQuestion(page);
  await switchRole(page,'founder');
  await page.getByRole('link',{name:"Answer Maya Chen's question",exact:true}).click();
  await page.getByRole('textbox',{name:'Answer Maya Chen’s question'}).fill('Audit answer: revenue $240,000 and reserve target $60,000.');
  await page.getByRole('button',{name:'Preview answer',exact:true}).click();
  await page.getByRole('button',{name:'Create simulated draft v2',exact:true}).click();
  await page.getByRole('link',{name:'Review packet v2',exact:true}).click();
  await expect(page.getByRole('button',{name:'Preview handoff of v2',exact:true})).toBeVisible();
}
async function handoffV2(page:Page):Promise<void>{
  await page.getByRole('button',{name:'Preview handoff of v2',exact:true}).click();
  await page.getByRole('checkbox',{name:'Founder intake.pdf',exact:true}).check();
  await page.getByRole('button',{name:'Confirm simulated handoff',exact:true}).click();
  await expect(page.getByRole('button',{name:'Confirm simulated handoff',exact:true})).toHaveCount(0);
}

const pageErrors=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{const errors:string[]=[];pageErrors.set(page,errors);page.on('pageerror',error=>errors.push(error.message));});
test.afterEach(async({page})=>{
  expect(pageErrors.get(page)).toEqual([]);
  await expect(page.getByText('Demo workspace · Chime supports live media',{exact:true})).toBeVisible();
});

for(const role of ['founder','advisor'] as const){
 test(`${role}: every shell destination, brand, role switch and skip link`,async({page})=>{
  await go(page,role==='founder'?'/founder/home':'/advisor/clients');
  const labels=role==='founder'?['Home','AI Chat','Call','Settings']:['Home','Clients','Call','Settings'];
  const headings=role==='founder'?['Hi, Alex','AI Chat','Call','Settings']:['Hi, Maya','Clients','Call','Settings'];
  for(let i=0;i<labels.length;i++){
   await navigate(page,labels[i]);
   await expect(page.locator('main h1').first()).toHaveText(headings[i]);
   await expect(page.locator('.navigation').getByRole('link',{name:labels[i],exact:true})).toHaveAttribute('aria-current','page');
  }
  await page.getByRole('link',{name:'Relay home'}).click();
  await expect(page).toHaveURL(new RegExp(`/${role}/${'home'}$`));
  await page.getByRole('link',{name:'Skip to main content'}).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await switchRole(page,role==='founder'?'advisor':'founder');
  await expect(page).toHaveURL(new RegExp(role==='founder'?'/advisor/home':'/founder/home'));
 });
 test(`${role}: global search finds drafts and originals with working filters`,async({page})=>{
  await go(page,role==='founder'?'/founder/home':'/advisor/clients');
  await page.getByRole('textbox',{name:'Search sources and drafts'}).fill('founder');
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/${role}/search\\?q=founder`));
  await expect(page.locator('main')).toContainText(packetName);
  await page.getByRole('button',{name:/^Documents \(/}).click();
  await expect(page.locator('main')).toContainText(packetName);
  await expect(page.locator('main').getByRole('link',{name:/Founder intake.pdf/})).toHaveCount(0);
  await page.getByRole('button',{name:/^Sources \(/}).click();
  await expect(page.locator('main').getByRole('link',{name:/Founder intake.pdf/}).first()).toBeVisible();
  await page.getByRole('button',{name:/^All \(/}).click();
  await page.locator('main').getByRole('link',{name:new RegExp(packetName)}).first().click();
  await expect(page).toHaveURL(new RegExp(`/${role}/documents\\?version=`));
  await expect(page.getByRole('region',{name:'Packet version 1 preview'})).toBeVisible();
 });
 test(`${role}: Settings tabs expose distinct content and destinations`,async({page})=>{
  await go(page,`/${role}/settings`);
  const profile=page.getByRole('tab',{name:'Profile',exact:true});
  await expect(profile).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('tabpanel')).toContainText(role==='founder'?'Alex Morgan':'Maya Chen');
  await page.getByRole('tab',{name:'Call privacy',exact:true}).click();
  await expect(page.getByRole('tabpanel')).toContainText('consent');
  await page.getByRole('link',{name:/Open Call/}).click();
  await expect(page).toHaveURL(new RegExp(`/${role}/call$`));
  await navigate(page,'Settings');
  await page.getByRole('tab',{name:'About this demo',exact:true}).click();
  await expect(page.getByRole('tabpanel')).toContainText('retained in this browser across reloads');
  await page.getByRole('tab',{name:'Profile',exact:true}).click();
  await page.getByRole('link',{name:/Return to workspace/}).click();
  await expect(page).toHaveURL(new RegExp(`/${role}/${'home'}$`));
 });
}

for(const [path,title,humanOnly] of routes){
 test(`${path}: audience, message preview/edit and confirmed send change thread`,async({page})=>{
  await go(page,path);await expect(page.locator('main h1').first()).toHaveText(title);
  if(humanOnly)await page.getByRole('button',{name:/^Call (Alex Morgan|Maya Chen)$/}).click();
  const audience=page.getByRole('tablist',{name:'Message audience',exact:true});
  if(!humanOnly){
   await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
   await page.getByRole('textbox',{name:'Message Relay',exact:true}).fill(`Private audit on ${path}`);
   await page.getByRole('button',{name:'Send',exact:true}).click();
   await expect(page.locator('.message-bubble').filter({hasText:`Private audit on ${path}`})).toHaveCount(1);
   await expect(page.getByRole('textbox',{name:'Message Relay',exact:true})).toHaveValue('');
   await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible();
   if(path==='/advisor/clients'){await expect(audience).toHaveCount(0);await go(page,'/advisor/documents?audience=human');}
   else await audience.getByRole('tab',{name:path.startsWith('/founder')?'Maya Chen':'Alex Morgan',exact:true}).click();
  }else await expect(audience).toHaveCount(0);
  const recipient=path.startsWith('/founder')?'Maya Chen':'Alex Morgan';
  const text=`Human audit on ${path}`;
  const input=page.getByRole('textbox',{name:`Message ${recipient}`,exact:true});
  await expect(page.getByRole('button',{name:'Preview message',exact:true})).toBeDisabled();
  await input.fill(text);await page.getByRole('button',{name:'Preview message',exact:true}).click();
  await expect(page.getByRole('heading',{name:`Preview message to ${recipient}`})).toBeVisible();
  await expect(page.locator('.message-bubble').filter({hasText:text})).toHaveCount(0);
  await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  await expect(input).toHaveValue(text);
  await page.getByRole('button',{name:'Preview message',exact:true}).click();
  await page.getByRole('button',{name:'Confirm simulated send',exact:true}).click();
  await expect(page.locator('.message-bubble').filter({hasText:text})).toHaveCount(1);
  await expect(input).toHaveValue('');
  if(!humanOnly){await audience.getByRole('tab',{name:'AI assistant',exact:true}).click();await expect(page.locator('.message-bubble').filter({hasText:text})).toHaveCount(0);}
 });
}

test('Home: chat entry, backend originals filters and packet links',async({page,documentsApi})=>{
 await go(page,'/founder/home');
 await page.getByRole('link',{name:'Start in AI Chat',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Message Relay',exact:true})).toBeFocused();
 await go(page,'/founder/home');
 for(const name of ['balance.csv','overview.txt']){
  await page.getByLabel('Upload documents',{exact:true}).setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from('Offline original: '+name)});
  await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 }
 expect(documentsApi.uploads).toHaveLength(2);
 await page.getByRole('searchbox',{name:'Search documents',exact:true}).fill('balance');
 await expect(page.getByRole('button',{name:'balance.csv',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'overview.txt',exact:true})).toHaveCount(0);
 await page.getByRole('searchbox',{name:'Search documents',exact:true}).fill('');
 await page.getByRole('button',{name:'Packets',exact:true}).click();
 await expect(page.getByRole('button',{name:'balance.csv',exact:true})).toHaveCount(0);
 await expect(page.getByRole('link',{name:packetName+' v1',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Original files',exact:true}).click();
 await expect(page.getByRole('link',{name:packetName+' v1',exact:true})).toHaveCount(0);
 for(const name of ['balance.csv','overview.txt']){
  const opened=page.waitForEvent('popup');
  await page.getByRole('button',{name,exact:true}).click();
  const popup=await opened;
  await expect(popup.locator('body')).toContainText('Offline original: '+name);
  await popup.close();
 }
 await page.getByRole('button',{name:'All documents',exact:true}).click();
 await page.getByRole('link',{name:packetName+' v1',exact:true}).click();
 await expect(page.getByRole('region',{name:'Packet version 1 preview'})).toBeVisible();
});

test('Sources: every file button, source citation, search clearing and Home links',async({page})=>{
 await go(page,'/founder/sources');
 for(const name of sourceNames){
  await page.getByRole('button',{name:new RegExp(name.replace('.','\\.'))}).click();
  await expect(page.locator('.founder-sources-preview-title h2')).toHaveText(name);
  await expect(page.getByRole('button',{name:new RegExp(name.replace('.','\\.'))})).toHaveAttribute('aria-pressed','true');
  await page.locator('.source-excerpt').locator('..').getByRole('link').first().click();
  await expect(page.locator('.founder-sources-preview-title h2')).toHaveText(name);
 }
 await page.getByRole('searchbox',{name:'Search original sources'}).fill('nothing matches');
 await expect(page.getByRole('heading',{name:'No sources match this search'})).toBeVisible();
 await page.getByRole('button',{name:'Clear search',exact:true}).click();
 await expect(page.getByRole('searchbox',{name:'Search original sources'})).toHaveValue('');
 await page.getByRole('link',{name:/Open AI Chat/}).click();
 await expect(page.locator('main h1')).toHaveText('AI Chat');
 await navigate(page,'Sources');await page.getByRole('link',{name:/Upload documents on Home/}).click();
 await expect(page.getByLabel('Upload documents',{exact:true})).toBeAttached();
});

test('Documents: real tabs, history selection, citations and ancillary destinations',async({page})=>{
 await go(page,'/founder/documents');
 await expect(page.getByRole('button',{name:'Compare versions',exact:true})).toBeDisabled();
 await page.getByRole('tab',{name:'Version history',exact:true}).click();
 await expect(page.getByRole('tab',{name:'Version history',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.getByRole('tabpanel',{name:'Version history',exact:true})).toContainText('Initial synthetic draft');
 await page.getByRole('button',{name:/View version 1/}).click();
 await expect(page.getByRole('tab',{name:'Preview',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.getByRole('region',{name:'Packet version 1 preview'})).toBeVisible();
 await page.getByRole('link',{name:'Discuss in AI Chat',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Message Relay',exact:true})).toBeFocused();
 await navigate(page,'Documents');await page.getByRole('link',{name:/Open Call/}).click();
 await expect(page.locator('main h1')).toHaveText('Call');
 await navigate(page,'Documents');await page.getByRole('link',{name:/View sources/}).click();
 await expect(page.locator('main h1')).toHaveText('Sources');
});

test('Advisor Clients: card, every shared row, search clearing, citations and call',async({page})=>{
 await go(page,'/advisor/clients');
 for(const name of sourceNames){
  await page.getByRole('button',{name:new RegExp(name.replace('.','\\.'))}).click();
  await expect(page.locator('.source-excerpt').locator('..').getByRole('heading',{level:3})).toHaveText(name);
 }
 await page.getByRole('button',{name:/Northstar Labs/}).click();
 await expect(page.getByRole('region',{name:'Packet version 1 preview'})).toBeVisible();
 await page.getByRole('button',{name:new RegExp(packetName)}).click();
 await expect(page.getByRole('region',{name:'Packet version 1 preview'})).toHaveCount(0);
 await page.getByRole('button',{name:new RegExp(packetName)}).click();
 await expect(page.getByRole('region',{name:'Packet version 1 preview'})).toBeVisible();
 await page.getByRole('textbox',{name:'Search assigned clients'}).fill('nothing matches');
 await expect(page.getByRole('heading',{name:'No matching assigned client'})).toBeVisible();
 await page.getByRole('button',{name:'Clear search',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Search assigned clients'})).toHaveValue('');
 await page.locator('.review-controls').getByRole('link',{name:'Forecast assumptions · p. 1',exact:true}).first().click();
 await expect(page.locator('.source-excerpt')).toContainText('$280,000');
 await page.getByRole('link',{name:'Call client',exact:true}).click();
 await expect(page.locator('main h1')).toHaveText('Call');
});

test('Advisor Reviews: selection, search clear, open specific document and call',async({page})=>{
 await go(page,'/advisor/reviews');
 await page.getByRole('button',{name:new RegExp('Northstar Labs '+packetName)}).click();
 await expect(page.locator('.advisor-review-detail')).toContainText('v1');
 await page.getByRole('textbox',{name:'Search assigned reviews'}).fill('nothing matches');
 await expect(page.getByRole('heading',{name:'No matching assigned review'})).toBeVisible();
 await page.getByRole('button',{name:'Clear search',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Search assigned reviews'})).toHaveValue('');
 await page.getByRole('link',{name:'Open document review',exact:true}).click();
 await expect(page.getByRole('region',{name:'Packet version 1 preview'})).toBeVisible();
 await navigate(page,'Reviews');await page.getByRole('link',{name:/Open Call/}).click();
 await expect(page.locator('main h1')).toHaveText('Call');
});

test('Advisor Documents: each original, return to packet, version select and Back to clients',async({page})=>{
 await go(page,'/advisor/documents?advisor_demo=browser');
 for(const [index,name] of sourceNames.entries()){
  await go(page,'/advisor/documents?version=00000000-0000-4000-8000-000000000021&source='+sourceIds[index]);
  await expect(page.getByRole('heading',{name,exact:true,level:2})).toBeVisible();
  await expect(page.locator('.source-excerpt')).toBeVisible();
  await expect(page.getByRole('button',{name:'Review approval of v1',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Return to packet v1',exact:true}).click();
  await expect(page.getByRole('region',{name:'Packet version 1 preview'})).toBeVisible();
 }
 await page.getByRole('combobox',{name:'Packet version',exact:true}).selectOption({label:'v1 · Review required'});
 await expect(page.getByRole('region',{name:'Packet version 1 preview'})).toBeVisible();
 await page.getByRole('button',{name:new RegExp(packetName)}).click();
 await expect(page.getByRole('region',{name:'Packet version 1 preview'})).toBeVisible();
 await page.getByRole('link',{name:/Open Call/}).click();
 await expect(page.locator('main h1')).toHaveText('Call');
 await navigate(page,'Documents');
 await page.getByRole('link',{name:'← Back to clients',exact:true}).click();
 await expect(page.locator('main h1')).toHaveText('Clients');
});

for(const path of ['/advisor/reviews','/advisor/documents','/advisor/call']){
 test(`${path}: every question/approval control has correct confirmation transition`,async({page})=>{
  await go(page,path === '/advisor/documents' ? path + '?advisor_demo=browser' : path);
  if(path==='/advisor/call')await page.getByText('Review actions for v1',{exact:true}).click();
  const question=page.getByRole('textbox',{name:'Draft question to Alex Morgan'});
  await question.fill('');await expect(page.getByRole('button',{name:'Preview questions',exact:true})).toBeDisabled();
  await question.fill('Audit question about reserve target.');
  await page.getByRole('button',{name:'Preview questions',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Question preview'})).toBeVisible();
  await page.getByRole('button',{name:'Cancel preview',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Question preview'})).toHaveCount(0);
  await page.getByRole('button',{name:'Review approval of v1',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Approve packet v1?'})).toBeVisible();
  await page.getByRole('button',{name:'Cancel approval',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Approve packet v1?'})).toHaveCount(0);
  await page.getByRole('button',{name:'Preview questions',exact:true}).click();
  await page.getByRole('button',{name:'Confirm simulated send',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Question already sent to Alex Morgan'})).toBeVisible();
  await page.getByRole('button',{name:'Return review with sent question',exact:true}).click();
  await expect(page.getByRole('button',{name:'Return review with sent question',exact:true})).toHaveCount(0);
  await question.fill('Second audit question about source conflict.');
  await page.getByRole('button',{name:'Preview questions',exact:true}).click();
  await page.getByRole('button',{name:'Return review with these questions',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Question preview'})).toHaveCount(0);
  await page.getByRole('button',{name:'Review approval of v1',exact:true}).click();
  await page.getByRole('button',{name:'Confirm simulated approval of v1',exact:true}).click();
  await expect(page.getByRole('button',{name:'Review approval of v1',exact:true})).toBeDisabled();
 });
}

test('V2: comparison toggle/selector, historical controls, handoff choices and approval',async({page})=>{
 await createV2(page);
 await page.getByRole('button',{name:'Compare versions',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Compare v1 with v2'})).toBeVisible();
 await page.getByRole('combobox',{name:'Earlier version'}).selectOption({index:0});
 await expect(page.locator('[aria-label="Version comparison"]')).toContainText('Audit answer');
 await page.getByRole('button',{name:'Close comparison',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Compare v1 with v2'})).toHaveCount(0);
 await page.locator('[aria-label="Version history"]').getByRole('button',{name:/v1/}).click();
 await expect(page.getByRole('region',{name:'Packet version 1 preview'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Preview handoff of v1',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:/Founder planning packet · v2/}).click();
 await page.getByRole('button',{name:'Preview handoff of v2',exact:true}).click();
 for(const name of sourceNames){
  await page.getByRole('checkbox',{name,exact:true}).check();
  await expect(page.getByRole('checkbox',{name,exact:true})).toBeChecked();
  await page.getByRole('checkbox',{name,exact:true}).uncheck();
  await expect(page.getByRole('checkbox',{name,exact:true})).not.toBeChecked();
 }
 await page.getByRole('button',{name:'Cancel handoff',exact:true}).click();
 await expect(page.getByRole('button',{name:'Confirm simulated handoff',exact:true})).toHaveCount(0);
 await handoffV2(page);
 await switchRole(page,'advisor');await navigate(page,'Documents');
 await page.getByRole('combobox',{name:'Packet version',exact:true}).selectOption({label:'v1 · Questions returned'});
 await expect(page.getByRole('button',{name:'Review approval of v1',exact:true})).toHaveCount(0);
 await page.getByRole('combobox',{name:'Packet version',exact:true}).selectOption({label:'v2 · Review required'});
 await expect(page.getByRole('region',{name:'Packet version 2 preview'})).toBeVisible();
 const v2=await page.getByRole('combobox',{name:'Packet version',exact:true}).inputValue();
 await go(page,'/advisor/documents?version='+v2+'&source='+sourceIds[0]);
 await expect(page.locator('.source-excerpt')).toContainText('$240,000');
 await expect(page.getByRole('button',{name:'Review approval of v2',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Return to packet v2',exact:true}).click();
 await go(page,'/advisor/documents?version='+v2+'&source='+sourceIds[2]);
 await expect(page.locator('.source-excerpt')).toHaveCount(0);
 await expect(page.getByRole('region',{name:'Packet version 2 preview'})).toBeVisible();
 await page.getByRole('button',{name:'Review approval of v2',exact:true}).click();
 await page.getByRole('button',{name:'Confirm simulated approval of v2',exact:true}).click();
 await expect(page.getByRole('button',{name:'Review approval of v2',exact:true})).toBeDisabled();
});

test('Clarification: preview/edit, answer, exact message citation and success destinations',async({page})=>{
 await sendQuestion(page);await switchRole(page,'founder');
 await page.getByRole('link',{name:"Answer Maya Chen's question",exact:true}).click();
 await expect(page.getByRole('button',{name:'Preview answer',exact:true})).toBeDisabled();
 await page.getByRole('textbox',{name:'Answer Maya Chen’s question'}).fill('Audit clarification with provenance.');
 await page.getByRole('button',{name:'Preview answer',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Proposed packet change'})).toBeVisible();
 await page.getByRole('button',{name:'Keep editing',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Proposed packet change'})).toHaveCount(0);
 await page.getByRole('textbox',{name:'Answer Maya Chen’s question'}).fill('Audit clarification final.');
 await page.getByRole('button',{name:'Preview answer',exact:true}).click();
 await page.getByRole('button',{name:'Create simulated draft v2',exact:true}).click();
 await expect(page.getByRole('link',{name:'Review packet v2',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Return to Home',exact:true}).click();
 await expect(page.locator('main h1')).toHaveText('Hi, Alex');
 await navigate(page,'Documents');
 await page.locator('.founder-documents-citations').getByRole('link',{name:/Founder answer/}).click();
 await expect(page.getByRole('tab',{name:'Maya Chen',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.locator('.message-bubble').filter({hasText:'Audit clarification final.'})).toHaveCount(1);
});

for(const initiator of ['founder','advisor'] as const){
 test(`${initiator}: invite, cancel, recipient decline/accept, mute and end without capture`,async({page})=>{
  await go(page,`/${initiator}/call`);
  const other=initiator==='founder'?'Maya Chen':'Alex Morgan';
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Camera off',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Microphone muted',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:`Call ${other}`,exact:true}).click();
  await page.getByRole('button',{name:'Cancel invite',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Ready to call?'})).toBeVisible();
  await page.getByRole('button',{name:`Call ${other}`,exact:true}).click();
  await page.getByRole('button',{name:'Unmute simulated microphone',exact:true}).click();
  await expect(page.getByRole('button',{name:'Mute simulated microphone',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Mute simulated microphone',exact:true}).click();
  await expect(page.getByRole('button',{name:'Unmute simulated microphone',exact:true})).toBeVisible();
  await switchRole(page,initiator==='founder'?'advisor':'founder');await navigate(page,'Call');
  await page.getByRole('button',{name:'Decline',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:'Ready to call?'})).toBeVisible();
  await page.getByRole('button',{name:/^Call (Alex Morgan|Maya Chen)$/}).click();
  await expect(page.getByRole('button',{name:'Cancel invite',exact:true})).toBeVisible();
  await switchRole(page,initiator);await navigate(page,'Call');
  await page.getByRole('button',{name:'Accept invitation',exact:true}).click();
  await expect(page.getByText('Connecting',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'End call',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Ready to call?'})).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
 });
}

test('Test states: empty file selection, slow cancel, explicit retry and reconnect',async({page,documentsApi})=>{
 await go(page,'/founder/home');
 await page.getByLabel('Upload documents',{exact:true}).setInputFiles([]);
 expect(documentsApi.uploads).toHaveLength(0);
 await expect(page.locator('.founder-home-upload-button')).toBeEnabled();
 await navigate(page,'AI Chat');
 await scenario(page,'slow');
 await page.getByRole('tab',{name:'Maya Chen',exact:true}).click();
 await page.getByRole('textbox',{name:'Message Maya Chen',exact:true}).fill('Audit cancelled slow message');
 await page.getByRole('button',{name:'Preview message',exact:true}).click();
 await page.getByRole('button',{name:'Confirm simulated send',exact:true}).click();
 await expect(page.getByRole('button',{name:'Cancel request',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Cancel request',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('cancelled');
 await expect(page.locator('.message-bubble').filter({hasText:'Audit cancelled slow message'})).toHaveCount(0);
 await scenario(page,'error');
 await expect(page.getByRole('heading',{name:'Workspace unavailable'})).toBeVisible();
 await page.getByRole('button',{name:'Retry loading',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Workspace unavailable'})).toBeVisible();
 await scenario(page,'normal');
 await expect(page.locator('main h1')).toHaveText('AI Chat');
 await scenario(page,'disconnected');
 await expect(page.getByRole('heading',{name:'Workspace unavailable'})).toBeVisible();
 await page.getByRole('button',{name:'Reconnect / refresh',exact:true}).click();
 await expect(page.locator('main h1')).toHaveText('AI Chat');
});

for(const role of ['founder','advisor'] as const){
 test(`${role}: mobile Search entry, empty search reset and every result link`,async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await go(page,role==='founder'?'/founder/home':'/advisor/clients');
  await page.getByRole('link',{name:'Search sources and drafts',exact:true}).click();
  await expect(page.locator('main h1')).toHaveText('Search');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole('searchbox',{name:'Search sources and drafts',exact:true}).fill('no matches in workspace');
  await expect(page.getByRole('heading',{name:'No matching results'})).toBeVisible();
  await page.getByRole('button',{name:'Show all sources and documents',exact:true}).click();
  await expect(page.getByRole('searchbox',{name:'Search sources and drafts',exact:true})).toHaveValue('');
  await page.getByRole('searchbox',{name:'Search sources and drafts',exact:true}).fill('intake');
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  for(const name of sourceNames){
   await page.getByRole('link',{name:`Open source ${name}`,exact:true}).click();
   await expect(page.locator('.source-excerpt')).toBeVisible();
   await page.getByRole('link',{name:'Search sources and drafts',exact:true}).click();
  }
  await page.getByRole('link',{name:`Open document ${packetName} v1`,exact:true}).click();
  await expect(page.getByRole('region',{name:'Packet version 1 preview'})).toBeVisible();
 });
 test(`${role}: Settings keyboard arrows/Home/End select and focus correct panel`,async({page})=>{
  await go(page,`/${role}/settings`);
  await page.getByRole('tab',{name:'Profile',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab',{name:'Call privacy',exact:true})).toBeFocused();
  await expect(page.getByRole('tab',{name:'Call privacy',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('tabpanel')).toContainText('Separate consent');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab',{name:'About this demo',exact:true})).toBeFocused();
  await page.getByRole('link',{name:'Explore documents',exact:true}).click();
  await expect(page.locator('main h1')).toHaveText('Documents');
  await navigate(page,'Settings');await page.getByRole('tab',{name:'Profile',exact:true}).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab',{name:'About this demo',exact:true})).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab',{name:'Profile',exact:true})).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Workspace profile');
 });
}

test('Founder Documents tabs support keyboard selection with correct timeline/preview',async({page})=>{
 await go(page,'/founder/documents');
 await page.getByRole('tab',{name:'Preview',exact:true}).focus();
 await page.keyboard.press('ArrowRight');
 await expect(page.getByRole('tab',{name:'Version history',exact:true})).toBeFocused();
 await expect(page.getByRole('tabpanel',{name:'Version history',exact:true})).toContainText('Initial synthetic draft');
 await page.keyboard.press('Home');
 await expect(page.getByRole('tab',{name:'Preview',exact:true})).toBeFocused();
 await expect(page.getByRole('region',{name:'Packet version 1 preview'})).toBeVisible();
 await page.keyboard.press('End');
 await expect(page.getByRole('tab',{name:'Version history',exact:true})).toBeFocused();
});

const emptyLinks=[
 ['/founder/sources','Go to Home','Hi, Alex'],
 ['/founder/documents','Browse sources','Sources'],
 ['/founder/call','View Documents','Documents'],
 ['/advisor/call','View Clients','Clients'],
 ['/founder/home/clarification','Return to Home','Hi, Alex'],
] as const;
for(const [path,link,heading] of emptyLinks){
 test(`${path}: empty-state ${link} destination works`,async({page})=>{
  await page.goto(path);
  await expect(page.locator('main')).toBeVisible();
  await scenario(page,'empty');
  await page.getByRole('link',{name:link,exact:true}).click();
  await expect(page.locator('main h1')).toHaveText(heading);
 });
}

test('Clarification conversation: human-only audience, preview/edit/send and breadcrumb',async({page})=>{
 await sendQuestion(page);await switchRole(page,'founder');
 await page.getByRole('link',{name:"Answer Maya Chen's question",exact:true}).click();
 await expect(page.getByRole('tablist',{name:'Message audience',exact:true})).toHaveCount(0);
 const input=page.getByRole('textbox',{name:'Message Maya Chen',exact:true});
 await input.fill('Clarification conversation audit message.');
 await page.getByRole('button',{name:'Preview message',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Preview message to Maya Chen'})).toBeVisible();
 await page.getByRole('button',{name:'Keep editing',exact:true}).click();
 await expect(input).toHaveValue('Clarification conversation audit message.');
 await page.getByRole('button',{name:'Preview message',exact:true}).click();
 await page.getByRole('button',{name:'Confirm simulated send',exact:true}).click();
 await expect(page.locator('.message-bubble').filter({hasText:'Clarification conversation audit message.'})).toHaveCount(1);
 await page.locator('.clarification-breadcrumb').getByRole('link',{name:'Home',exact:true}).click();
 await expect(page.locator('main h1')).toHaveText('Hi, Alex');
});

test('Search preserves role isolation for an unshared new packet version',async({page})=>{
 await createV2(page);await switchRole(page,'advisor');
 await page.getByRole('textbox',{name:'Search sources and drafts'}).fill('Audit answer:');
 await page.getByRole('textbox',{name:'Search sources and drafts'}).press('Enter');
 await expect(page.getByRole('heading',{name:'No matching results'})).toBeVisible();
 await expect(page.getByRole('link',{name:/Open document.*v2/})).toHaveCount(0);
 await page.getByRole('button',{name:'Show all sources and documents',exact:true}).click();
 await expect(page.getByRole('link',{name:/Open document.*v1/})).toBeVisible();
 await expect(page.getByRole('link',{name:/Open document.*v2/})).toHaveCount(0);
});

test('Founder Documents no-match Clear search returns selected current packet',async({page})=>{
 await go(page,'/founder/documents?q=nothing-matches');
 await expect(page.getByRole('heading',{name:'No documents match this search'})).toBeVisible();
 await page.getByRole('link',{name:'Clear search',exact:true}).click();
 await expect(page.getByRole('region',{name:'Packet version 1 preview'})).toBeVisible();
});
