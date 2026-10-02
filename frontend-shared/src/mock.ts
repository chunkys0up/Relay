import { createFixture, advisor, founder } from './fixtures';
import { RelayError } from './types';
import type { CaseSnapshot, MutationOptions, Receipt, RelayAdapter, RelayCommand, Role, Scenario, Message, Clarification } from './types';

/** In-memory synthetic demo only. No HTTP, AWS, media, disk persistence or AI. */
export class MockRelayAdapter implements RelayAdapter {
 readonly mode='simulated' as const;
 private state=createFixture(); private scenario:Scenario='normal';
 private listeners=new Set<()=>void>(); private receipts=new Map<string,{body:string;receipt:Receipt<CaseSnapshot>}>();
 private inflight=new Map<string,{body:string;result:Promise<Receipt<CaseSnapshot>>}>();
 constructor(private readonly latency=180){}
 setScenario(scenario:Scenario):void{this.scenario=scenario;this.emit();}
 reset():void{this.state=createFixture();this.scenario='normal';this.receipts.clear();this.emit();}
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
  if(command.expected_revision!==revision)throw new RelayError('STALE_REVISION','The case or call changed. Refresh and review before trying again.');
  if('packet_version_id' in command){const packet=this.state.packets.find(p=>p.id===command.packet_version_id);if(!packet||packet.hash!==command.packet_hash||packet.id!==this.state.current_packet_version_id)throw new RelayError('STALE_PACKET','This packet version is no longer current. Review the latest version.');if(role==='advisor'&&!this.state.grants.some(g=>g.advisor_id===actor.id&&g.packet_version_id===packet.id&&g.packet_hash===packet.hash))throw new RelayError('NOT_FOUND','This version has not been shared with you.');}
  const requireRole=(needed:Role):void=>{if(role!==needed)throw new RelayError('FORBIDDEN','This action is unavailable for this role.');};
  const validText=(text:string):void=>{if(!text.trim()||text.length>8000)throw new RelayError('VALIDATION_FAILED','Enter between 1 and 8,000 characters.');};
  const message=(text:string,audience:Message['audience'],attachments:string[]=[]):Message=>({id:crypto.randomUUID(),owner_id:actor.id,author:{kind:'human',id:actor.id,name:actor.name},created_at:new Date().toISOString(),audience,text,attachments,citations:[],status:'stored'});
  const question=(id:string,rev:number):Clarification=>{const q=this.state.clarifications.find(q=>q.id===id);if(!q||q.revision!==rev)throw new RelayError('PREVIEW_CHANGED','The question changed. Preview it again.');return q;};
  switch(command.kind){
   case 'upload':requireRole('founder');throw new RelayError('SIMULATED_UNAVAILABLE','Upload not performed. This demo has no storage endpoint; your file stays on this device.');
   case 'message':{
    validText(command.text);if(command.audience.kind==='human'&&(!command.confirmed||command.audience.recipient_id!==(role==='founder'?advisor.id:founder.id)))throw new RelayError('FORBIDDEN','Confirm the named recipient before sending.');
    const allowed=new Set(this.visible(role).sources.map(s=>s.id));if(command.attachments.some(id=>!allowed.has(id)))throw new RelayError('NOT_FOUND','An attachment is unavailable.');
    this.state.messages.push(message(command.text,command.audience,command.attachments));break;
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
    const answerBytes=new TextEncoder().encode(JSON.stringify({author:m.author,created_at:m.created_at,text:m.text}));
    const digest=await crypto.subtle.digest('SHA-256',answerBytes);
    if(command.expected_revision!==this.state.revision||q.status!=='sent')throw new RelayError('STALE_REVISION','The clarification changed while preparing the attributed answer. Review it again.');
    const answerHash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    const answerCitation={source_id:m.id,source_hash:answerHash,source_kind:'message' as const,label:`${actor.name} · Founder answer · ${new Date(m.created_at).toLocaleDateString('en-US')}`,locator:{field:'message'}};
    m.citations=[answerCitation];this.state.messages.push(m);q.status='answered';q.revision++;
    const old=this.state.packets.find(p=>p.id===command.packet_version_id)!;const id=crypto.randomUUID();const hash=id.replaceAll('-','').repeat(2);
    const taskId=crypto.randomUUID();
    this.state.tasks=this.state.tasks.map(task=>task.state==='Blocked'?{...task,title:'Record founder clarification',state:'Done',detail:'Response attributed to the founder; source conflicts remain for human review.'}:task);
    this.state.tasks.push({id:taskId,order:this.state.tasks.length+1,title:`Prepare packet v${old.version+1}`,state:'In progress',detail:'Simulated draft job; no backend or AI invocation.',citations:old.citations});
    this.state.ui_state='Thinking / Working';this.state.activity='Simulated draft preparation. Ordered task recorded before work.';this.state.revision++;this.state.event_cursor='fixture:'+this.state.revision;this.emit();
    // After this checkpoint, cancelling the caller cannot undo recorded work.
    // The fixture job completes independently, just as a submitted backend job would.
    await new Promise<void>(resolve=>setTimeout(resolve,Math.max(this.latency,450)));
    this.state.packets.push({...structuredClone(old),id,version:old.version+1,hash,created_at:new Date().toISOString(),status:'draft',previous_version_id:old.id,changes:['Founder supplied an attributed clarification. Source conflict retained for review.'],citations:[...old.citations,answerCitation],content:old.content+'\n\nFounder clarification (synthetic, unverified):\n'+command.text});this.state.current_packet_version_id=id;this.state.status='Draft ready';this.state.ui_state='Idle';this.state.activity='Simulated new draft. Confirm sharing before advisor review.';
    this.state.tasks=this.state.tasks.map(task=>task.id===taskId?{...task,state:'Done',detail:'Simulated draft prepared; human review and renewed sharing required.'}:task);
    this.state.flags.push(...this.state.flags.filter(f=>f.packet_version_id===old.id).map(f=>({...structuredClone(f),id:crypto.randomUUID(),packet_version_id:id})));break;
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
   case 'consent':{
    const call=this.state.call;if(!call||['ended','failed'].includes(call.state))throw new RelayError('INVALID_TRANSITION','There is no active simulated call.');const me=call.participants.find(p=>p.actor.id===actor.id)!;me.capture_consent=command.consent;me.consent_revision++;call.capture=command.consent==='withdrawn'?'off':'awaiting_consent';call.revision++;break;
   }
  }
  this.state.revision++;this.state.event_cursor='fixture:'+this.state.revision;const receipt=this.receipt(role);this.receipts.set(key,{body,receipt:structuredClone(receipt)});this.emit();return receipt;
 }
}
