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
  // Several entities may be emitted at the same case revision. Compare against
  // the pre-batch floor so one event cannot incorrectly discard its siblings.
  const floor=this.current.revision;
  for(const event of events){
   if(event.case_id!==this.current.id)throw new RelayError('FORBIDDEN','Event belongs to another case.');
   if(this.seen.has(event.event_id)||event.case_revision<floor)continue;
   if(event.type==='sharing.updated')throw new RelayError('RESYNC_REQUIRED','Sharing scope changed. Clear cached data and fetch a new authorized snapshot.');
   this.seen.add(event.event_id);
   const upsert=<T extends {id:string}>(items:T[],item:T):T[]=>[...items.filter(i=>i.id!==item.id),item];
   switch(event.type){
    case 'case.updated':Object.assign(this.current,event.data);break;
    case 'tasks.updated':this.current.tasks=event.data.tasks;break;
    case 'source.updated':this.current.sources=upsert(this.current.sources,event.data.source);break;
    case 'message.updated':this.current.messages=upsert(this.current.messages,event.data.message);break;
    case 'packet.created':this.current.packets=upsert(this.current.packets,event.data.packet);this.current.flags=event.data.flags;break;
    case 'clarification.updated':this.current.clarifications=upsert(this.current.clarifications,event.data.clarification);break;
    case 'review.created':this.current.reviews=upsert(this.current.reviews,event.data.review);break;
    case 'call.updated':this.current.call=event.data.call;break;
   }
   this.current.revision=Math.max(this.current.revision,event.case_revision);this.current.event_cursor=event.cursor;
  }
  // Client memory is bounded. A server must also bound its replay window.
  if(this.seen.size>2000)this.seen=new Set([...this.seen].slice(-1000));
  return this.snapshot();
 }
}
