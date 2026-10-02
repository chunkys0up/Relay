import { describe,it,expect } from 'vitest';
import { EventReplay } from './events';
import type { CaseEvent } from './events';
import { createFixture } from './fixtures';
describe('proposed event replay contract',()=>{
 it('deduplicates replay and applies sibling events at one revision',()=>{const s=createFixture();const replay=new EventReplay(s);const event:CaseEvent={type:'case.updated',event_id:'e1',cursor:'cursor-2',case_id:s.id,case_revision:2,occurred_at:'2026-10-02T18:00:00Z',data:{status:'Draft ready',ui_state:'Idle',activity:null,current_packet_version_id:s.current_packet_version_id}};const sibling:CaseEvent={...event,type:'tasks.updated',event_id:'e2',cursor:'cursor-3',data:{tasks:[]}};expect(replay.applyBatch([event,sibling,event]).tasks).toEqual([]);expect(replay.snapshot().event_cursor).toBe('cursor-3');expect(replay.applyBatch([{...event,event_id:'old',case_revision:1}]).revision).toBe(2);});
 it('rejects cross-case events and demands a resync for changed sharing',()=>{const s=createFixture();const replay=new EventReplay(s);const e:CaseEvent={type:'sharing.updated',event_id:'e1',cursor:'x',case_id:s.id,case_revision:2,occurred_at:'2026-10-02T18:00:00Z',data:{grant:s.grants[0]}};expect(()=>replay.applyBatch([{...e,case_id:'other'}])).toThrow('another case');expect(()=>replay.applyBatch([e])).toThrow('Sharing scope changed');});
});
