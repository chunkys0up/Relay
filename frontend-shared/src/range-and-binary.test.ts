import { expect, it } from 'vitest';
import { MockRelayAdapter } from './mock';

it.each(['$240k-$300k','$2 million to $3 million'])('does not confirm a revenue range written as %s',async(range)=>{
 const api=new MockRelayAdapter(0);
 const state=(await api.mutate('founder',{kind:'message',expected_revision:1,audience:{kind:'private_ai'},text:`Revenue is ${range}. Reserve target is $60,000.`,attachments:[],confirmed:false},{key:'range'})).data;
 expect(state.packets).toHaveLength(1);expect(state.ui_state).toBe('Needs input');
});

it('retains binary bytes without inventing extracted text or citations',async()=>{
 const api=new MockRelayAdapter(0);const bytes='%PDF-1.7\nexample';
 const command={kind:'upload' as const,expected_revision:1,name:'original.pdf',mime_type:'application/pdf',bytes:bytes.length,content_base64:btoa(bytes)};
 const state=(await api.mutate('founder',command,{key:'binary'})).data;
 const source=state.sources.find(s=>s.name==='original.pdf');
 expect(source?.content_base64).toBe(btoa(bytes));expect(source?.extraction).toBe('unsupported');expect(source?.excerpt).toBe('');expect(source?.citations).toEqual([]);
});
