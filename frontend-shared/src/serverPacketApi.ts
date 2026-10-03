import type { CaseSnapshot, PacketVersion, Source } from './types';
import { initializeWorkflowSession, workflowRequest } from '../../client-frontend/src/workflow/api';
import type { WorkflowCase } from '../../client-frontend/src/workflow/api';

export type ServerPacket = WorkflowCase['packets'][number] & {
  title?: string; stage?: PacketVersion['status'];
  stage_events?: { id?: string; actor?: string; action?: string; stage?: string; at?: string; created_at?: string }[];
  fields?: Record<string, string>; extracted_text?:string;
  cloud?: { status: string };
}
export interface ServerShare {
  id:string; packet_id:string; packet_hash:string; source_ids:string[];
  created_at:string; active:boolean; grant_id:string|null; advisor_id:string|null;
}
export interface ServerCase extends Omit<WorkflowCase, 'packets'> {
  current_packet_id?: string | null; packets: ServerPacket[]; legacy_sync?: { status: string };
  activity?: string | null; created_at?: string; synthetic_example?:boolean;
  shares?:ServerShare[]; reviews?:{id:string;reviewer_id:string;packet_id:string;packet_hash:string;decision:'approved'|'questions_returned';note:string;created_at:string}[];
}
export const serverPacketUrl = (caseId: string, packetId: string): string =>
  `/api/workflow/cases/${encodeURIComponent(caseId)}/packets/${encodeURIComponent(packetId)}/download?inline=true`;
export const serverSourceUrl = (caseId: string, sourceId: string): string =>
  `/api/workflow/cases/${encodeURIComponent(caseId)}/sources/${encodeURIComponent(sourceId)}/preview`;
export async function listServerCases(signal?: AbortSignal): Promise<ServerCase[]> {
  await initializeWorkflowSession();
  return (await workflowRequest<{ items: ServerCase[] }>('/cases', { signal })).items;
}
export async function getServerCase(id: string, signal?: AbortSignal): Promise<ServerCase> {
  await initializeWorkflowSession();
  return workflowRequest<ServerCase>(`/cases/${encodeURIComponent(id)}`, { signal });
}
export async function createServerCase(company: string, goal: string): Promise<ServerCase> {
  await initializeWorkflowSession();
  return workflowRequest<ServerCase>('/cases', { method: 'POST', body: { company, goal } });
}
export async function importServerPacket(caseId: string, revision: number, file: File): Promise<void> {
  await initializeWorkflowSession();
  const form=new FormData();form.set('expected_revision',String(revision));form.set('file',file);
  await workflowRequest<unknown>(`/cases/${encodeURIComponent(caseId)}/packets/import`,{method:'POST',file:form});
}
export async function loadServerExamples(): Promise<ServerCase[]> {
  await initializeWorkflowSession();
  return (await workflowRequest<{items:ServerCase[]}>('/cases/examples',{method:'POST'})).items;
}
export async function retryServerCaseSync(caseId: string): Promise<ServerCase> {
  await initializeWorkflowSession();
  return workflowRequest<ServerCase>(`/cases/${encodeURIComponent(caseId)}/sync`, { method: 'POST' });
}
export async function changeServerPacketStage(caseId: string, packet: PacketVersion, revision: number, stage: PacketVersion['status'], key: string): Promise<void> {
  await initializeWorkflowSession();
  await workflowRequest<unknown>(`/cases/${encodeURIComponent(caseId)}/packets/${encodeURIComponent(packet.id)}/stage`,
    { method: 'POST', key, body: { expected_revision: revision, packet_hash: packet.hash, target_stage: stage } });
}
export async function createServerShare(caseId:string, packet:PacketVersion, revision:number, sourceIds:string[],key:string):Promise<{id:string;invite_code:string}> {
  await initializeWorkflowSession();
  return workflowRequest(`/cases/${encodeURIComponent(caseId)}/shares`,{method:'POST',key,body:{expected_revision:revision,packet_id:packet.id,packet_hash:packet.hash,source_ids:sourceIds}});
}
export async function revokeServerShare(caseId:string, inviteId:string):Promise<void> {
  await initializeWorkflowSession();
  await workflowRequest(`/cases/${encodeURIComponent(caseId)}/shares/${encodeURIComponent(inviteId)}/revoke`,{method:'POST'});
}
export async function redeemServerShare(code:string):Promise<{case_id:string}> {
  await initializeWorkflowSession();
  return workflowRequest('/invites/redeem',{method:'POST',body:{invite_code:code.trim()}});
}
export async function reviewServerPacket(caseId:string,packet:PacketVersion,revision:number,decision:'approved'|'questions_returned',note:string,key:string):Promise<void> {
  await initializeWorkflowSession();
  await workflowRequest(`/cases/${encodeURIComponent(caseId)}/packets/${encodeURIComponent(packet.id)}/review`,
    {method:'POST',key,body:{expected_revision:revision,packet_hash:packet.hash,decision,note}});
}
export interface AnswerPreview {
  preview_id:string; preview_hash:string; packet_id:string; packet_hash:string;
  review_id:string; version:number; pages:number; case_revision:number;
}
export const serverAnswerPreviewUrl=(caseId:string,previewId:string):string=>
  `/api/workflow/cases/${encodeURIComponent(caseId)}/answer-previews/${encodeURIComponent(previewId)}/pdf`;
export async function createServerAnswerPreview(caseId:string,packet:PacketVersion,reviewId:string,answer:string,revision:number,key:string):Promise<AnswerPreview>{
  await initializeWorkflowSession();
  return workflowRequest(`/cases/${encodeURIComponent(caseId)}/packets/${encodeURIComponent(packet.id)}/answer-preview`,
    {method:'POST',key,body:{expected_revision:revision,packet_hash:packet.hash,review_id:reviewId,answer}});
}
export async function confirmServerAnswer(caseId:string,preview:AnswerPreview,revision:number,key:string):Promise<{packet_id:string;packet_hash:string;version:number}>{
  await initializeWorkflowSession();
  return workflowRequest(`/cases/${encodeURIComponent(caseId)}/answer-previews/${encodeURIComponent(preview.preview_id)}/confirm`,
    {method:'POST',key,body:{expected_revision:revision,preview_hash:preview.preview_hash}});
}
export async function discardServerAnswer(caseId:string,preview:AnswerPreview,revision:number,key:string):Promise<void>{
  await initializeWorkflowSession();
  await workflowRequest(`/cases/${encodeURIComponent(caseId)}/answer-previews/${encodeURIComponent(preview.preview_id)}/discard`,
    {method:'POST',key,body:{expected_revision:revision,preview_hash:preview.preview_hash}});
}
const validStages = new Set<PacketVersion['status']>(['draft', 'in_review', 'questions_returned', 'approved']);
function packetStage(value: string | undefined): PacketVersion['status'] {
  if (!value || !validStages.has(value as PacketVersion['status'])) throw new Error('The server returned a packet without a recognized stage.');
  return value as PacketVersion['status'];
}
export function mapServerCase(state: ServerCase): CaseSnapshot {
  const packets = state.packets.map((item, index): PacketVersion => ({
    id: item.id, document_id: state.id + ':packet', version: item.version, hash: item.hash, created_at: item.created_at,
    title: item.title?.trim() || `Packet v${item.version}`, status: packetStage(item.stage),
    previous_version_id: state.packets[index - 1]?.id ?? null,
    changes: (item.stage_events ?? []).map(event => [event.action, event.stage].filter(Boolean).join(' - ')).filter(Boolean),
    citations: [], content: item.extracted_text?.trim() || '',
    server_pdf_url: serverPacketUrl(state.id, item.id), stage_events: item.stage_events ?? [], cloud_status: item.cloud?.status,
  }));
  const sources = state.sources.map((item): Source => ({
    id: item.id, revision: state.revision, name: item.name, mime_type: item.mime_type ?? '',
    bytes: item.bytes ?? 0, hash: item.hash, created_at: item.created_at ?? state.created_at ?? '',
    extraction: item.extraction_status === 'ready' ? 'ready' : item.extraction_status === 'unsupported' ? 'unsupported' : 'failed',
    citations: [], excerpt: '', error: item.status_detail ?? null, server_pdf_url: serverSourceUrl(state.id, item.id), cloud_status:item.cloud?.status,
  }));
  const current = packets.find(item => item.id === state.current_packet_id) ?? packets.at(-1);
  const taskState = (value:string): 'Pending'|'In progress'|'Blocked'|'Done' =>
    value === 'done' || value === 'Done' ? 'Done' : value === 'blocked' || value === 'Blocked' ? 'Blocked' : value === 'in_progress' || value === 'In progress' ? 'In progress' : 'Pending';
  const tasks = state.tasks.map((item,index)=>({
    id:item.id, order:item.order ?? index, title:item.title, state:taskState(item.state),
    detail:item.detail ?? item.blocking_reason ?? null, citations:[],
  }));
  const flags = state.flags.map((item,index)=>({
    id:`workflow-flag-${index}`, kind:item.kind === 'conflict' ? 'conflict' as const : 'missing' as const,
    text:item.detail, packet_version_id:current?.id ?? '', citations:[], resolved:false,
  }));
  const status = current?.status === 'approved' ? 'Approved' : current?.status === 'questions_returned' ? 'Questions returned' : current?.status === 'in_review' ? 'In review' : current ? 'Draft ready' : 'Information needed';
  const founderFact=state.facts?.founder_name;
  const founderName=founderFact?.state==='confirmed'&&founderFact.value?.trim()?founderFact.value.trim():'Founder';
  return {
    id: state.id, revision: state.revision, company: state.company,
    founder: { id: 'founder', name: founderName, role: 'founder' }, advisors: [{ id: 'advisor', name: 'Advisor', role: 'advisor' }],
    status, ui_state: state.ui_state === 'Needs input' ? 'Needs input' : state.ui_state === 'Thinking / Working' ? 'Thinking / Working' : 'Idle',
    activity: state.activity ?? null, current_packet_version_id: current?.id ?? null,
    sources, packets, tasks, messages: [], flags, clarifications: [],
    reviews:(state.reviews??[]).map(item=>({id:item.id,revision:state.revision,
      reviewer:{id:item.reviewer_id,name:'Advisor',role:'advisor' as const},
      packet_version_id:item.packet_id,packet_hash:item.packet_hash,decision:item.decision,note:item.note,
      clarification_id:null,created_at:item.created_at})),
    grants:(state.shares??[]).filter(item=>item.active&&item.advisor_id).map(item=>({
      id:item.grant_id??item.id,revision:state.revision,advisor_id:item.advisor_id!,
      packet_version_id:item.packet_id,packet_hash:item.packet_hash,
      source_ids:item.source_ids,message_ids:[],
    })), call: null,
    event_cursor: String(state.revision), server_legacy_sync_status:state.legacy_sync?.status, server_synthetic_example:state.synthetic_example,
  };
}
