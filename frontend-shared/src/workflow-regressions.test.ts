import { describe, expect, it } from 'vitest';
import { MockRelayAdapter } from './mock';
import { advisor } from './fixtures';

const answer = '2026 revenue is $240,000. My reserve target is $60,000.';
const message = (text:string, revision=1) => ({kind:'message' as const, expected_revision:revision, audience:{kind:'private_ai' as const},text,attachments:[],confirmed:false});
const file = (text:string) => ({kind:'upload' as const, expected_revision:1,name:'intake.txt',mime_type:'text/plain',bytes:new TextEncoder().encode(text).length,content_base64:btoa(text)});

describe('reported workflow regressions',()=>{
 it('ingests actual file contents and gives the source a verifiable hash',async()=>{
  const api=new MockRelayAdapter(0);const body='Annual revenue: $240,000\nReserve target: $60,000';
  const s=(await api.mutate('founder',file(body),{key:'upload'})).data;
  const source=s.sources.find(s=>s.name==='intake.txt');
  expect(source).toBeDefined();expect(source?.excerpt).toContain(body);expect(source?.hash).toMatch(/^[a-f0-9]{64}$/);expect(source?.extraction).toBe('ready');
  expect(s.tasks.length).toBeGreaterThan(3);
  expect((await api.snapshot('advisor')).data.sources.some(s=>s.name==='intake.txt')).toBe(false);
 });
 it('rejects metadata-only uploads and does not add a source',async()=>{
  const api=new MockRelayAdapter(0);
  await expect(api.mutate('founder',{kind:'upload',expected_revision:1,name:'fake.txt',mime_type:'text/plain',bytes:4},{key:'fake'})).rejects.toBeDefined();
  expect((await api.snapshot('founder')).data.sources).toHaveLength(3);
 });
 it('rejects inconsistent file lengths without changing state',async()=>{
  const api=new MockRelayAdapter(0);
  await expect(api.mutate('founder',{...file('hello'),bytes:999},{key:'bad'})).rejects.toBeDefined();
  expect((await api.snapshot('founder')).data.revision).toBe(1);
 });
 it('blocks advisor upload',async()=>{
  const api=new MockRelayAdapter(0);await expect(api.mutate('advisor',file('hello'),{key:'advisor'})).rejects.toMatchObject({code:'FORBIDDEN'});
 });
 it('initial answer creates exactly one private unapproved draft and completes input task',async()=>{
  const api=new MockRelayAdapter(0);const command=message(answer);
  const s=(await api.mutate('founder',command,{key:'initial-answer'})).data;
  expect(s.clarifications).toHaveLength(0);expect(s.packets).toHaveLength(2);expect(s.ui_state).toBe('Idle');expect(s.status).toBe('Draft ready');
  expect(s.tasks.find(t=>t.id==='t3')?.state).toBe('Done');expect(s.packets[1].status).toBe('draft');expect(s.packets[1].content).toContain(answer);
  expect(s.packets[1].citations.some(c=>c.source_kind==='message')).toBe(true);
  const view=(await api.snapshot('advisor')).data;expect(view.packets).toHaveLength(1);expect(view.messages.some(m=>m.text===answer)).toBe(false);
  await api.mutate('founder',command,{key:'initial-answer'});expect((await api.snapshot('founder')).data.packets).toHaveLength(2);
 });
 it.each(['Thanks for your help','Revenue is $240,000','Reserve target is $60,000'])('does not declare an incomplete answer ready: %s',async(text)=>{
  const api=new MockRelayAdapter(0);const s=(await api.mutate('founder',message(text),{key:'partial'})).data;
  expect(s.ui_state).toBe('Needs input');expect(s.packets).toHaveLength(1);expect(s.tasks.find(t=>t.id==='t3')?.state).toBe('Blocked');
 });
 it('human message is delivered without accidentally answering the private initial question',async()=>{
  const api=new MockRelayAdapter(0);const s=(await api.mutate('founder',{...message(answer),audience:{kind:'human',recipient_id:advisor.id},confirmed:true},{key:'human'})).data;
  expect(s.packets).toHaveLength(1);expect((await api.snapshot('advisor')).data.messages.some(m=>m.text===answer)).toBe(true);
 });
 it('concurrent stale initial answers cannot create competing drafts',async()=>{
  const api=new MockRelayAdapter(0);const results=await Promise.allSettled([api.mutate('founder',message(answer),{key:'a'}),api.mutate('founder',message(answer),{key:'b'})]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await api.snapshot('founder')).data.packets).toHaveLength(2);
 });
});
