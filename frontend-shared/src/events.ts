import { RelayError } from './types';
import type { CallSession, Clarification, Message, PacketVersion, Review, Source, Task, UiState, CaseSnapshot, ShareGrant, Flag } from './types';

export interface EventPayloads {
 'case.updated': Pick<CaseSnapshot,'status'|'activity'|'current_packet_version_id'> & {ui_state:UiState};
 'tasks.updated': {tasks:Task[]};
 'source.updated': {source:Source};
 'message.updated': {message:Message};
 'packet.created': {packet:PacketVersion;flags:Flag[]};
 'clarification.updated': {clarification:Clarification};
 'review.created': {review:Review};
 'sharing.updated': {grant:ShareGrant};
 'call.updated': {call:CallSession};
}
export type CaseEvent = {[K in keyof EventPayloads]: {type:K;event_id:string;cursor:string;case_id:string;case_revision:number;occurred_at:string;data:EventPayloads[K]}}[keyof EventPayloads];
export type SocketControl = {type:'ready';protocol_version:1;cursor:string;mode:'live'|'simulated'} | {type:'replay_complete';cursor:string} | {type:'resync_required';reason:'cursor_expired'|'scope_changed'} | {type:'pong';nonce:string};
export type SocketRequest = {type:'subscribe';after_cursor:string|null;protocol_version:1} | {type:'ack';cursor:string} | {type:'ping';nonce:string};

/** Applies a replay batch as one case transaction; real transport awaits contract approval. */
export class EventReplay {
 private seen = new Set<string>();
 constructor(private current:CaseSnapshot){}
 snapshot():CaseSnapshot{return structuredClone(this.current);}
 replace(snapshot:CaseSnapshot):void{this.current=structuredClone(snapshot);this.seen.clear();}
 applyBatch(events:CaseEvent[]):CaseSnapshot{
  if(events.length>2000)throw new RelayError('RESYNC_REQUIRED','Replay batch exceeded the client limit.');
  // Validate before changing any state. Failed batches are atomic.
  for(const event of events){
   if(event.case_id!==this.current.id)throw new RelayError('FORBIDDEN','Event belongs to another case.');
   if(event.type==='sharing.updated'&&!this.seen.has(event.event_id)&&event.case_revision>=this.current.revision)throw new RelayError('RESYNC_REQUIRED','Sharing scope changed. Clear cached data and fetch a new authorized snapshot.');
  }
  const draft=structuredClone(this.current);
  const seen=new Set(this.seen);
  // Case revisions order transactions. Stable sort preserves server order for
  // sibling events. Opaque cursors themselves are never compared/incremented.
  for(const event of [...events].sort((a,b)=>a.case_revision-b.case_revision)){
   if(seen.has(event.event_id)||event.case_revision<draft.revision)continue;
   seen.add(event.event_id);
   const upsert=<T extends {id:string;revision?:number}>(items:T[],item:T):T[]=>{
    const old=items.find(i=>i.id===item.id);
    if(old?.revision!==undefined&&item.revision!==undefined&&old.revision>item.revision)return items;
    return [...items.filter(i=>i.id!==item.id),item];
   };
   switch(event.type){
    case 'case.updated':Object.assign(draft,event.data);break;
    case 'tasks.updated':draft.tasks=event.data.tasks;break;
    case 'source.updated':draft.sources=upsert(draft.sources,event.data.source);break;
    case 'message.updated':draft.messages=upsert(draft.messages,event.data.message);break;
    case 'packet.created':draft.packets=upsert(draft.packets,event.data.packet);draft.flags=[...draft.flags.filter(f=>f.packet_version_id!==event.data.packet.id),...event.data.flags];break;
    case 'clarification.updated':draft.clarifications=upsert(draft.clarifications,event.data.clarification);break;
    case 'review.created':draft.reviews=upsert(draft.reviews,event.data.review);break;
    case 'call.updated':if(!draft.call||draft.call.id!==event.data.call.id||draft.call.revision<=event.data.call.revision)draft.call=event.data.call;break;
   }
   draft.revision=Math.max(draft.revision,event.case_revision);draft.event_cursor=event.cursor;
  }
  this.current=draft;this.seen=seen;
  // Client memory is bounded. A server must also bound its replay window.
  if(this.seen.size>2000)this.seen=new Set([...this.seen].slice(-1000));
  return this.snapshot();
 }
}
