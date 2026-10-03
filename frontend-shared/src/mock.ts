import { createFixture, advisor, founder } from './fixtures';
import { readSource } from './intake';
import { initialFounderAnswer } from './founder-answer';
import { RelayError } from './types';
import type { CaseSnapshot, MutationOptions, Receipt, RelayAdapter, RelayCommand, Role, Scenario, Message, Clarification, PacketVersion, Citation } from './types';

interface PendingDraft { packet:PacketVersion; oldId:string; taskId:string; key:string; body:string; role:Role }
export interface DemoState { state:CaseSnapshot; receipts:[string,{body:string;receipt:Receipt<CaseSnapshot>}][]; pending:PendingDraft|null }

/** Isolated demo engine; browser persistence is supplied explicitly by its wrapper. */
export class MockRelayAdapter implements RelayAdapter {
 readonly mode='simulated' as const;
 private state=createFixture(); private scenario:Scenario='normal';
 private listeners=new Set<()=>void>(); private receipts=new Map<string,{body:string;receipt:Receipt<CaseSnapshot>}>();
 private inflight=new Map<string,{body:string;result:Promise<Receipt<CaseSnapshot>>}>();
 private pendingDraft:PendingDraft|null=null;
 constructor(private readonly latency=180,private readonly checkpoint?:(data:DemoState)=>Promise<void>){}
 exportState():DemoState{return structuredClone({state:this.state,receipts:[...this.receipts],pending:this.pendingDraft});}
 importState(data:DemoState):void{this.state=structuredClone(data.state);this.receipts=new Map(structuredClone(data.receipts));this.pendingDraft=structuredClone(data.pending);}
 private async save():Promise<void>{await this.checkpoint?.(this.exportState());}
 async resumeDraft():Promise<void>{if(!this.pendingDraft)return;const job=this.pendingDraft;this.finishDraft();this.receipts.set(job.key,{body:job.body,receipt:this.receipt(job.role)});await this.save();this.emit();}
 private finishDraft():void{
  const job=this.pendingDraft;if(!job)return;
  this.state.packets.push(job.packet);this.state.current_packet_version_id=job.packet.id;this.state.status='Draft ready';this.state.ui_state='Idle';this.state.activity='Local demo draft prepared. Confirm sharing this new version before advisor review.';
  this.state.tasks=this.state.tasks.map(task=>task.id===job.taskId?{...task,state:'Done',detail:'Local demo draft prepared; human review and renewed sharing required.'}:task);
  this.state.flags.push(...this.state.flags.filter(flag=>flag.packet_version_id===job.oldId).map(flag=>({...structuredClone(flag),id:crypto.randomUUID(),packet_version_id:job.packet.id})));
  this.pendingDraft=null;this.state.revision++;this.state.event_cursor='fixture:'+this.state.revision;
 }
 private async prepareDraft(old:PacketVersion,text:string,citations:Citation[],key:string,body:string,role:Role,initial=false):Promise<void>{
  const id=crypto.randomUUID();const taskId=crypto.randomUUID();
  const packet:PacketVersion={...structuredClone(old),imported_pdf:undefined,id,version:old.version+1,hash:id.replaceAll('-','').repeat(2),created_at:new Date().toISOString(),status:'draft',previous_version_id:old.id,changes:[initial?'Founder supplied private revenue and reserve details. Source conflict retained for review.':'Founder supplied an attributed clarification. Source conflict retained for review.'],citations:[...old.citations,...citations],content:old.content+'\n\nFounder clarification (reported, unverified):\n'+text};
  this.pendingDraft={packet,oldId:old.id,taskId,key,body,role};
  this.state.tasks=this.state.tasks.map(task=>task.state==='Blocked'?{...task,title:'Record founder clarification',state:'Done',detail:'Response attributed to the founder; source conflicts remain for human review.'}:task);
  this.state.tasks.push({id:taskId,order:this.state.tasks.length+1,title:`Prepare packet v${packet.version}`,state:'In progress',detail:'Local demo draft job; no backend or AI invocation.',citations:packet.citations});
  this.state.ui_state='Thinking / Working';this.state.activity='Local demo draft preparation. Ordered task recorded before work.';this.state.revision++;this.state.event_cursor='fixture:'+this.state.revision;
  await this.save();this.emit();
  // A recorded job survives cancellation and can be resumed from browser storage.
  await new Promise<void>(resolve=>setTimeout(resolve,Math.max(this.latency,450)));
  this.finishDraft();
 }
 private async messageCitation(message:Message):Promise<Citation>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({author:message.author,created_at:message.created_at,text:message.text})));
  return {source_id:message.id,source_hash:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''),source_kind:'message',label:`${message.author.name} · Founder answer · ${new Date(message.created_at).toLocaleDateString('en-US')}`,locator:{field:'message'}};
 }
 setScenario(scenario:Scenario):void{this.scenario=scenario;this.emit();}
 reset():void{this.state=createFixture();this.pendingDraft=null;this.scenario='normal';this.receipts.clear();this.emit();}
 subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 private emit():void{for(const listener of this.listeners)listener();}
 private async wait(signal?:AbortSignal):Promise<void>{
  if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');
  await new Promise<void>((resolve,reject)=>{const onAbort=():void=>{clearTimeout(timer);reject(new DOMException('Request cancelled','AbortError'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);resolve();},this.scenario==='slow'?1800:this.latency);signal?.addEventListener('abort',onAbort,{once:true});});
  if(this.scenario==='error')throw new RelayError('UNAVAILABLE','Simulated service error. Try the Normal scenario and retry.',true);
  if(this.scenario==='disconnected')throw new RelayError('DISCONNECTED','Simulated connection lost. Reconnect before making changes.',true);
 }
 private visible(role:Role):CaseSnapshot{
  const view=structuredClone(this.state);const actor=role==='founder'?founder:advisor;
  const grants=view.grants.filter(g=>g.advisor_id===actor.id);
  view.messages=view.messages.filter(m=>m.audience.kind==='private_ai'?m.owner_id===actor.id:m.author.id===actor.id||m.audience.recipient_id===actor.id);
  if(role==='founder')view.clarifications=view.clarifications.filter(q=>q.status!=='preview');
  if(role==='advisor'){
   const sources=new Set(grants.flatMap(g=>g.source_ids));const packets=new Set(grants.map(g=>g.packet_version_id));
   view.sources=view.sources.filter(s=>sources.has(s.id));view.packets=view.packets.filter(p=>packets.has(p.id));view.flags=view.flags.filter(f=>packets.has(f.packet_version_id));
   view.clarifications=view.clarifications.filter(q=>packets.has(q.packet_version_id));view.reviews=view.reviews.filter(r=>packets.has(r.packet_version_id));
   view.tasks=[];view.activity=null;view.current_packet_version_id=view.packets.at(-1)?.id??null;
   if(view.call&&!packets.has(view.call.packet_version_id))view.call=null;
  }
  if(this.scenario==='empty'){view.sources=[];view.packets=[];view.messages=[];view.tasks=[];view.flags=[];view.clarifications=[];view.reviews=[];view.current_packet_version_id=null;view.call=null;}
  return view;
 }
 async snapshot(role:Role,signal?:AbortSignal):Promise<Receipt<CaseSnapshot>>{await this.wait(signal);return this.receipt(role);}
 private receipt(role:Role):Receipt<CaseSnapshot>{return {data:this.visible(role),meta:{mode:'simulated',request_id:crypto.randomUUID()}};}
 async mutate(role:Role,command:RelayCommand,options:MutationOptions):Promise<Receipt<CaseSnapshot>>{
  const key=role+':'+options.key;const body=JSON.stringify(command);const existing=this.inflight.get(key);
  if(existing){if(existing.body!==body)throw new RelayError('IDEMPOTENCY_CONFLICT','This operation key is already processing different content.');return existing.result;}
  const result=this.execute(role,command,options);this.inflight.set(key,{body,result});
  try{return await result;}finally{this.inflight.delete(key);}
 }
 private async execute(role:Role,command:RelayCommand,options:MutationOptions):Promise<Receipt<CaseSnapshot>>{
  await this.wait(options.signal);const actor=role==='founder'?founder:advisor;const body=JSON.stringify(command);const key=actor.id+':'+options.key;const prior=this.receipts.get(key);
  if(prior){if(prior.body!==body)throw new RelayError('IDEMPOTENCY_CONFLICT','This operation key was already used for different content.');return structuredClone(prior.receipt);}
  if(this.scenario==='empty')throw new RelayError('NOT_FOUND','No synthetic case data in the empty scenario.');
  const callCommand=command.kind==='call_action'||command.kind==='consent';
  if(this.state.ui_state==='Thinking / Working'&&'packet_version_id' in command)throw new RelayError('INVALID_TRANSITION','A simulated draft is being prepared. Wait for its result before starting another version-bound action.');
  const revision=callCommand?this.state.call?.revision:this.state.revision;
  // An AI reply only appends to the thread, so it never conflicts with concurrent case changes.
  if(command.kind!=='ai_reply'&&command.expected_revision!==revision)throw new RelayError('STALE_REVISION','The case or call changed. Refresh and review before trying again.');
  if('packet_version_id' in command){const packet=this.state.packets.find(p=>p.id===command.packet_version_id);if(!packet||packet.hash!==command.packet_hash||packet.id!==this.state.current_packet_version_id)throw new RelayError('STALE_PACKET','This packet version is no longer current. Review the latest version.');if(role==='advisor'&&!this.state.grants.some(g=>g.advisor_id===actor.id&&g.packet_version_id===packet.id&&g.packet_hash===packet.hash))throw new RelayError('NOT_FOUND','This version has not been shared with you.');}
  const requireRole=(needed:Role):void=>{if(role!==needed)throw new RelayError('FORBIDDEN','This action is unavailable for this role.');};
  const validText=(text:string):void=>{if(!text.trim()||text.length>8000)throw new RelayError('VALIDATION_FAILED','Enter between 1 and 8,000 characters.');};
  const message=(text:string,audience:Message['audience'],attachments:string[]=[]):Message=>({id:crypto.randomUUID(),owner_id:actor.id,author:{kind:'human',id:actor.id,name:actor.name},created_at:new Date().toISOString(),audience,text,attachments,citations:[],status:'stored'});
  const question=(id:string,rev:number):Clarification=>{const q=this.state.clarifications.find(q=>q.id===id);if(!q||q.revision!==rev)throw new RelayError('PREVIEW_CHANGED','The question changed. Preview it again.');return q;};
  switch(command.kind){
   case 'upload':{
    requireRole('founder');const source=await readSource(command);
    if(command.expected_revision!==this.state.revision)throw new RelayError('STALE_REVISION','The case changed while reading this file. Refresh and add it again.');
    this.state.sources.push(source);this.state.tasks.push({id:crypto.randomUUID(),order:this.state.tasks.length+1,title:'Add local source: '+source.name,state:'Done',detail:source.error??'Original bytes retained and UTF-8 text extracted locally.',citations:source.citations});break;
   }
   case 'message':{
    validText(command.text);if(command.audience.kind==='human'&&(!command.confirmed||command.audience.recipient_id!==(role==='founder'?advisor.id:founder.id)))throw new RelayError('FORBIDDEN','Confirm the named recipient before sending.');
    const allowed=new Set(this.visible(role).sources.map(s=>s.id));if(command.attachments.some(id=>!allowed.has(id)))throw new RelayError('NOT_FOUND','An attachment is unavailable.');
    const m=message(command.text,command.audience,command.attachments);if(command.files?.length)m.files=command.files;
    const initial=role==='founder'&&command.audience.kind==='private_ai'&&this.state.ui_state!=='Thinking / Working'&&this.state.tasks.some(task=>task.state==='Blocked'&&task.title==='Confirm reserve target and revenue')&&!this.state.clarifications.some(q=>q.status==='sent')?initialFounderAnswer([...this.state.messages,m],actor.id):null;
    if(initial){
     const evidence=await Promise.all(initial.messages.map(item=>this.messageCitation(item)));
     if(command.expected_revision!==this.state.revision)throw new RelayError('STALE_REVISION','The case changed while attributing your answer. Refresh before trying again.');
     this.state.messages.push(m);for(const item of initial.messages){const stored=this.state.messages.find(stored=>stored.id===item.id)!;stored.citations=[evidence[initial.messages.indexOf(item)]];}
     const old=this.state.packets.find(packet=>packet.id===this.state.current_packet_version_id)!;
     await this.prepareDraft(old,initial.text,evidence,key,body,role,true);
    }else this.state.messages.push(m);
    break;
   }
   case 'handoff':{
    requireRole('founder');if(command.advisor_id!==advisor.id)throw new RelayError('FORBIDDEN','Choose the assigned advisor.');
    if(command.source_ids.some(id=>!this.state.sources.some(s=>s.id===id))||command.message_ids.some(id=>!this.state.messages.some(m=>m.id===id)))throw new RelayError('NOT_FOUND','A selected share item is unavailable.');
    this.state.grants.push({id:crypto.randomUUID(),revision:1,advisor_id:advisor.id,packet_version_id:command.packet_version_id,packet_hash:command.packet_hash,source_ids:command.source_ids,message_ids:command.message_ids});this.state.packets.find(p=>p.id===command.packet_version_id)!.status='in_review';this.state.status='Advisor review';break;
   }
   case 'preview':requireRole('advisor');validText(command.text);if(command.recipient_id!==founder.id)throw new RelayError('FORBIDDEN','Questions must be addressed to the assigned founder.');this.state.clarifications.push({id:crypto.randomUUID(),revision:1,packet_version_id:command.packet_version_id,packet_hash:command.packet_hash,recipient:founder,text:command.text,citations:command.citations,status:'preview',message_id:null});break;
   case 'send':{
    requireRole('advisor');const q=question(command.clarification_id,command.clarification_revision);if(q.text!==command.text||q.recipient.id!==command.recipient_id||q.packet_version_id!==command.packet_version_id)throw new RelayError('PREVIEW_CHANGED','Recipient, version or text changed. Preview again.');
    if(q.status!=='preview')throw new RelayError('INVALID_TRANSITION','This question has already been sent.');const m=message(q.text,{kind:'human',recipient_id:founder.id});this.state.messages.push(m);q.status='sent';q.message_id=m.id;q.revision++;this.state.ui_state='Needs input';break;
   }
   case 'answer':{
    requireRole('founder');validText(command.text);const q=question(command.clarification_id,command.clarification_revision);if(q.status!=='sent')throw new RelayError('INVALID_TRANSITION','This question is not awaiting an answer.');
    const m=message(command.text,{kind:'human',recipient_id:advisor.id});
    const answerCitation=await this.messageCitation(m);
    if(command.expected_revision!==this.state.revision||q.status!=='sent')throw new RelayError('STALE_REVISION','The clarification changed while preparing the attributed answer. Review it again.');
    m.citations=[answerCitation];this.state.messages.push(m);q.status='answered';q.revision++;
    const old=this.state.packets.find(p=>p.id===command.packet_version_id)!;
    await this.prepareDraft(old,command.text,[answerCitation],key,body,role);break;
   }
   case 'review':{
    requireRole('advisor');let q:Clarification|undefined;
    if(command.decision==='questions_returned'){q=question(command.clarification_id??'',command.clarification_revision??-1);if(q.packet_version_id!==command.packet_version_id||q.status==='answered')throw new RelayError('PREVIEW_CHANGED','Preview a question for this exact version.');}
    if(this.state.reviews.some(r=>r.packet_version_id===command.packet_version_id&&r.decision==='approved'))throw new RelayError('INVALID_TRANSITION','This exact version already has an approval.');
    if(q&&q.status==='preview'){const m=message(q.text,{kind:'human',recipient_id:founder.id});this.state.messages.push(m);q.status='sent';q.message_id=m.id;q.revision++;}
    this.state.reviews.push({id:crypto.randomUUID(),revision:1,reviewer:advisor,packet_version_id:command.packet_version_id,packet_hash:command.packet_hash,decision:command.decision,clarification_id:q?.id??null,created_at:new Date().toISOString()});
    this.state.packets.find(p=>p.id===command.packet_version_id)!.status=command.decision==='approved'?'approved':'questions_returned';this.state.status=command.decision==='approved'?'Advisor approved':'Questions returned';this.state.ui_state=command.decision==='approved'?'Idle':'Needs input';break;
   }
   case 'invite':{
    if(command.recipient_id!==(role==='founder'?advisor.id:founder.id))throw new RelayError('FORBIDDEN','Choose the assigned participant.');
    if(!this.state.grants.some(g=>g.advisor_id===advisor.id&&g.packet_version_id===command.packet_version_id&&g.packet_hash===command.packet_hash))throw new RelayError('FORBIDDEN','Confirm sharing this exact packet with the advisor before inviting them to review it.');
    if(this.state.call&&!['ended','failed'].includes(this.state.call.state))throw new RelayError('INVALID_TRANSITION','A call invitation is already active.');
    this.state.call={id:crypto.randomUUID(),revision:1,state:'ringing',packet_version_id:command.packet_version_id,participants:[founder,advisor].map(a=>({actor:a,accepted:a.id===actor.id,muted:true,capture_consent:'not_given',consent_revision:0})),capture:'off',processing:'not_started',cleanup:'not_required'};break;
   }
   case 'call_action':{
    const call=this.state.call;if(!call||['ended','failed'].includes(call.state))throw new RelayError('INVALID_TRANSITION','There is no active simulated call.');const me=call.participants.find(p=>p.actor.id===actor.id)!;
    if(command.action==='accept'){me.accepted=true;call.state='connecting';}
    if(command.action==='decline'||command.action==='end'){call.state='ended';call.capture='off';}
    if(command.action==='mute')me.muted=true;if(command.action==='unmute')me.muted=false;call.revision++;break;
   }
   case 'ai_reply':{
    if(!command.text.trim())throw new RelayError('VALIDATION_FAILED','The assistant reply was empty.');
    this.state.messages.push({id:crypto.randomUUID(),owner_id:actor.id,author:{kind:'ai',id:'relay',name:'Relay assistant'},created_at:new Date().toISOString(),audience:{kind:'private_ai'},text:command.text,attachments:[],citations:[],status:'stored'});break;
   }
   case 'consent':{
    const call=this.state.call;if(!call||['ended','failed'].includes(call.state))throw new RelayError('INVALID_TRANSITION','There is no active simulated call.');const me=call.participants.find(p=>p.actor.id===actor.id)!;me.capture_consent=command.consent;me.consent_revision++;call.capture=command.consent==='withdrawn'?'off':'awaiting_consent';call.revision++;break;
   }
  }
  this.state.revision++;this.state.event_cursor='fixture:'+this.state.revision;const receipt=this.receipt(role);this.receipts.set(key,{body,receipt:structuredClone(receipt)});await this.save();this.emit();return receipt;
 }
}
