export type Role = 'founder' | 'advisor';
export type UiState = 'Idle' | 'Thinking / Working' | 'Needs input';
export type TaskState = 'Pending' | 'In progress' | 'Blocked' | 'Done';
export type CallState = 'ringing' | 'connecting' | 'connected' | 'ended' | 'failed';
export interface Actor { id: string; name: string; role: Role }
export interface Citation { source_id: string; source_hash: string; source_kind?:'document'|'message'; label: string; locator: { page?: number; sheet?: string; row?: number; field?: string } }
export interface ImportedPdf { url:string; provider:'Amazon Textract'; original_sha256:string }
export interface Source { id: string; revision: number; name: string; mime_type: string; bytes: number; hash: string; created_at: string; extraction: 'queued'|'processing'|'ready'|'failed'|'unsupported'; citations: Citation[]; excerpt: string; error: string|null; content_base64?:string; imported_pdf?:ImportedPdf }
export interface PacketVersion { id: string; document_id: string; version: number; hash: string; created_at: string; title: string; status: 'draft'|'in_review'|'questions_returned'|'approved'; previous_version_id: string|null; changes: string[]; citations: Citation[]; content: string; imported_pdf?:ImportedPdf }
export interface Task { id: string; order: number; title: string; state: TaskState; detail: string|null; citations: Citation[] }
export type Audience = {kind:'private_ai'} | {kind:'human';recipient_id:string};
export interface FileRef { id:string; name:string }
export interface Message { id:string; author:{kind:'human'|'ai';id:string;name:string}; created_at:string; audience:Audience; text:string; attachments:string[]; files?:FileRef[]; citations:Citation[]; status:'stored'|'delivered'|'failed'; owner_id:string }
export interface Flag { id:string; kind:'missing'|'conflict'|'uncertain'; text:string; packet_version_id:string; citations:Citation[]; resolved:boolean }
export interface Clarification { id:string; revision:number; packet_version_id:string; packet_hash:string; recipient:Actor; text:string; citations:Citation[]; status:'preview'|'sent'|'answered'; message_id:string|null }
export interface Review { id:string; revision:number; reviewer:Actor; packet_version_id:string; packet_hash:string; decision:'approved'|'questions_returned'; clarification_id:string|null; created_at:string }
export interface ShareGrant { id:string; revision:number; advisor_id:string; packet_version_id:string; packet_hash:string; source_ids:string[]; message_ids:string[] }
export interface CallSession { id:string; revision:number; state:CallState; packet_version_id:string; participants:{actor:Actor;accepted:boolean;muted:boolean;capture_consent:'not_given'|'granted'|'withdrawn';consent_revision:number}[]; capture:'off'|'awaiting_consent'|'starting'|'capturing'|'stopping'|'stopped'|'failed'; processing:'not_started'|'queued'|'transcribing'|'summarizing'|'needs_confirmation'|'complete'|'failed'; cleanup:'not_required'|'pending'|'complete'|'failed' }
export interface CaseSnapshot { id:string; revision:number; company:string; founder:Actor; advisors:Actor[]; status:'Information needed'|'Draft ready'|'Advisor review'|'Questions returned'|'Advisor approved'; ui_state:UiState; activity:string|null; current_packet_version_id:string|null; sources:Source[]; packets:PacketVersion[]; tasks:Task[]; messages:Message[]; flags:Flag[]; clarifications:Clarification[]; reviews:Review[]; grants:ShareGrant[]; call:CallSession|null; event_cursor:string }
export interface VersionInput { expected_revision:number; packet_version_id:string; packet_hash:string }
export interface MutationOptions { key:string; signal?:AbortSignal }
export interface Receipt<T> { data:T; meta:{mode:'simulated';request_id:string} }
export type Scenario = 'normal'|'empty'|'error'|'slow'|'disconnected';
export type RelayCommand =
 | {kind:'message';expected_revision:number;audience:Audience;text:string;attachments:string[];files?:FileRef[];confirmed:boolean}
 | {kind:'upload';expected_revision:number;name:string;mime_type:string;bytes:number;content_base64?:string}
 | ({kind:'handoff';advisor_id:string;source_ids:string[];message_ids:string[]} & VersionInput)
 | ({kind:'preview';text:string;recipient_id:string;citations:Citation[]} & VersionInput)
 | ({kind:'send';clarification_id:string;clarification_revision:number;text:string;recipient_id:string} & VersionInput)
 | ({kind:'answer';clarification_id:string;clarification_revision:number;text:string} & VersionInput)
 | ({kind:'review';decision:'approved'|'questions_returned';clarification_id?:string;clarification_revision?:number} & VersionInput)
 | ({kind:'invite';recipient_id:string} & VersionInput)
 | {kind:'call_action';expected_revision:number;action:'accept'|'decline'|'mute'|'unmute'|'end'}
 | {kind:'consent';expected_revision:number;consent:'granted'|'withdrawn'}
 | {kind:'ai_reply';text:string};
export interface RelayAdapter { readonly mode:'simulated'; snapshot(role:Role,signal?:AbortSignal):Promise<Receipt<CaseSnapshot>>; mutate(role:Role,command:RelayCommand,options:MutationOptions):Promise<Receipt<CaseSnapshot>>; subscribe(listener:()=>void):()=>void; setScenario(scenario:Scenario):void; reset():void }
export class RelayError extends Error { constructor(public readonly code:string,message:string,public readonly retryable=false){super(message);this.name='RelayError';} }
