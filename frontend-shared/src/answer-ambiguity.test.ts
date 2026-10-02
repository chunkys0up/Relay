import { describe, expect, it } from 'vitest';
import { MockRelayAdapter } from './mock';

async function answerSequence(texts:string[]):Promise<void>{
 const api=new MockRelayAdapter(0);let state=(await api.snapshot('founder')).data;
 for(const text of texts)state=(await api.mutate('founder',{kind:'message',expected_revision:state.revision,audience:{kind:'private_ai'},text,attachments:[],confirmed:false},{key:crypto.randomUUID()})).data;
 expect(state.packets).toHaveLength(1);expect(state.ui_state).toBe('Needs input');expect(state.tasks.find(t=>t.id==='t3')?.state).toBe('Blocked');
}
describe('ambiguous and withdrawn initial values remain unresolved',()=>{
 it.each([
  'Revenue is $240,000 or $300,000. Reserve target is $60,000.',
  'Revenue is $240,000-$300,000. Reserve target is $60,000.',
  'If revenue is $240,000, reserve target is $60,000.',
 ])('does not draft from %s',async(text)=>answerSequence([text]));
 it('requires reconfirmation after a value is withdrawn',async()=>answerSequence(['Revenue is $240,000.','My revenue is unknown.','Reserve target is $60,000.']));
});
