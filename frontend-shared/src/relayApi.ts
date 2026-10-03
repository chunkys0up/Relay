import { API_BASE } from './callsApi';

// Real FastAPI backend (backend/app/main.py): Strands chat and Postgres/S3 documents.
// Like callsApi, this is separate from the simulated RelayAdapter and never touches mock case state.

// Postgres seed case for Northstar Labs (backend/db/seed.sql); override per environment.
export const LIVE_CASE_ID: string = import.meta.env.VITE_CASE_ID ?? '22222222-2222-2222-2222-222222222222';

export interface LiveDocument { id: string; case_id: string; filename: string; s3_key: string; uploaded_at: string }
export interface LiveUpload extends LiveDocument { source_id: string; bucket: string; key: string; content_type: string | null; size: number }

export class RelayApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'RelayApiError'; }
}

async function request(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new RelayApiError(0, `Cannot reach the backend at ${API_BASE}. Is it running?`);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new RelayApiError(response.status, typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status})`);
  }
  return response;
}

export async function listDocuments(caseId: string, signal?: AbortSignal): Promise<LiveDocument[]> {
  const response = await request(`/api/documents?case_id=${encodeURIComponent(caseId)}`, { signal });
  return response.json() as Promise<LiveDocument[]>;
}

export async function uploadDocument(caseId: string, file: File, signal?: AbortSignal): Promise<LiveUpload> {
  const form = new FormData();
  form.append('case_id', caseId);
  form.append('file', file);
  const response = await request('/api/documents/upload', { method: 'POST', body: form, signal });
  return response.json() as Promise<LiveUpload>;
}

/** Short-lived S3 link for viewing a stored document. */
export async function documentUrl(documentId: string, signal?: AbortSignal): Promise<string> {
  const response = await request(`/api/documents/${encodeURIComponent(documentId)}/url`, { signal });
  return ((await response.json()) as { url: string }).url;
}

/** Streams the assistant reply, calling onChunk per text delta; resolves with the full reply. */
export async function streamChat(sessionId: string, message: string, onChunk: (text: string) => void, options: { signal?: AbortSignal; documentIds?: string[]; caseId?: string; conversationId?: string } = {}): Promise<string> {
  const { signal, documentIds = [], caseId, conversationId } = options;
  const response = await request('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId, document_ids: documentIds, case_id: caseId, conversation_id: conversationId }),
    signal,
  });
  if (!response.body) throw new RelayApiError(0, 'The backend returned no reply stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let reply = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) { reply += text; onChunk(text); }
  }
  return reply;
}

export type ChecklistState = 'todo' | 'in_progress' | 'blocked' | 'done';
export interface ChecklistItem { id: string; case_id: string; title: string; detail: string | null; state: ChecklistState; position: number; created_by: 'agent' | 'user'; created_at: string; updated_at: string }
export interface ActivityEntry { id: string; case_id: string; actor: 'agent' | 'founder' | 'advisor' | 'system'; text: string; created_at: string }

export async function listChecklist(caseId: string, signal?: AbortSignal): Promise<ChecklistItem[]> {
  return (await request(`/api/cases/${encodeURIComponent(caseId)}/checklist`, { signal })).json() as Promise<ChecklistItem[]>;
}

export async function setChecklistState(caseId: string, itemId: string, state: ChecklistState): Promise<ChecklistItem> {
  const response = await request(`/api/cases/${encodeURIComponent(caseId)}/checklist/${encodeURIComponent(itemId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }),
  });
  return response.json() as Promise<ChecklistItem>;
}

// Editing files. Each change saves a new version in S3; earlier versions are kept.
export type EditorRole = 'founder' | 'advisor';

/** Files that can be read and edited as text. */
export const isTextFile = (filename: string): boolean => /\.(md|txt|csv|json|html?)$/i.test(filename);

export async function documentText(documentId: string, signal?: AbortSignal): Promise<string> {
  return ((await (await request(`/api/documents/${encodeURIComponent(documentId)}/text`, { signal })).json()) as { content: string }).content;
}

export async function saveDocumentText(documentId: string, content: string, role: EditorRole): Promise<LiveDocument> {
  const response = await request(`/api/documents/${encodeURIComponent(documentId)}/text`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, role }),
  });
  return response.json() as Promise<LiveDocument>;
}

export async function uploadDocumentVersion(documentId: string, file: File, role: EditorRole): Promise<LiveDocument> {
  const form = new FormData();
  form.append('file', file);
  form.append('role', role);
  return (await request(`/api/documents/${encodeURIComponent(documentId)}/versions`, { method: 'POST', body: form })).json() as Promise<LiveDocument>;
}

// Packet versions (the `drafts` table) and the advisor's review decisions.
export type PacketStatus = 'draft' | 'in_review' | 'approved' | 'questions_returned';
export type ReviewDecision = 'approved' | 'questions_returned';
export interface LivePacket {
  id: string; case_id: string; version: number; status: PacketStatus; created_at: string;
  change_note: string | null; created_by: string | null;
  review_decision: ReviewDecision | null; review_notes: string | null; reviewed_at: string | null;
  review_resolved_at: string | null;
}

const packetPath = (caseId: string, packetId?: string): string =>
  `/api/cases/${encodeURIComponent(caseId)}/packets${packetId ? `/${encodeURIComponent(packetId)}` : ''}`;

export async function listPackets(caseId: string, signal?: AbortSignal): Promise<LivePacket[]> {
  return (await request(packetPath(caseId), { signal })).json() as Promise<LivePacket[]>;
}

/** Short-lived S3 link to the packet PDF. */
export async function packetUrl(caseId: string, packetId: string, signal?: AbortSignal): Promise<string> {
  return ((await (await request(`${packetPath(caseId, packetId)}/url`, { signal })).json()) as { url: string }).url;
}

/** The packet's Markdown summary: Relay's, generated from the PDF on first request, or the advisor's edit. */
export interface PacketSummaryView { summary: string; edited_by: string | null; edited_at: string | null }

export async function packetSummary(caseId: string, packetId: string, signal?: AbortSignal): Promise<PacketSummaryView> {
  return (await request(`${packetPath(caseId, packetId)}/summary`, { signal })).json() as Promise<PacketSummaryView>;
}

export async function editPacketSummary(caseId: string, packetId: string, summary: string, editor: string, role: EditorRole = 'advisor'): Promise<PacketSummaryView> {
  const response = await request(`${packetPath(caseId, packetId)}/summary`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary, editor, role }),
  });
  return response.json() as Promise<PacketSummaryView>;
}

/** Drop the advisor's edit and go back to Relay's summary. */
export async function revertPacketSummary(caseId: string, packetId: string, role: EditorRole = 'advisor'): Promise<PacketSummaryView> {
  return (await request(`${packetPath(caseId, packetId)}/summary/edit?role=${role}`, { method: 'DELETE' })).json() as Promise<PacketSummaryView>;
}

/** What changed in a packet version: its saved note, and Relay's comparison with the previous version. */
export interface PacketChanges { previous_version: number | null; change_note: string | null; created_by: string | null; changes: string | null }

export async function packetChanges(caseId: string, packetId: string, signal?: AbortSignal): Promise<PacketChanges> {
  return (await request(`${packetPath(caseId, packetId)}/changes`, { signal })).json() as Promise<PacketChanges>;
}

/** When anything in the case last changed; polled so other people's changes show up live. */
export async function caseVersion(caseId: string, signal?: AbortSignal): Promise<string | null> {
  return ((await (await request(`/api/cases/${encodeURIComponent(caseId)}/version`, { signal })).json()) as { version: string | null }).version;
}

/** The founder marks the advisor's latest decision as resolved, so it stops being shown. */
export async function resolvePacketReview(caseId: string, packetId: string): Promise<LivePacket> {
  return (await request(`${packetPath(caseId, packetId)}/review/resolve`, { method: 'POST' })).json() as Promise<LivePacket>;
}

/** Save an uploaded PDF as the next packet version. */
export async function uploadPacketVersion(caseId: string, file: File, role: EditorRole): Promise<LivePacket> {
  const form = new FormData();
  form.append('file', file);
  form.append('role', role);
  return (await request(packetPath(caseId), { method: 'POST', body: form })).json() as Promise<LivePacket>;
}

export async function reviewPacket(caseId: string, packetId: string, decision: ReviewDecision, notes: string): Promise<LivePacket> {
  const response = await request(`${packetPath(caseId, packetId)}/review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, notes }),
  });
  return response.json() as Promise<LivePacket>;
}

export async function listActivity(caseId: string, limit = 20, signal?: AbortSignal): Promise<ActivityEntry[]> {
  return (await request(`/api/cases/${encodeURIComponent(caseId)}/activity?limit=${limit}`, { signal })).json() as Promise<ActivityEntry[]>;
}

/** Fired after anything that can change the case's checklist, activity or documents (AI replies, uploads, ticks). */
export const CASE_UPDATED_EVENT = 'relay:case-updated';
export function announceCaseUpdate(): void { window.dispatchEvent(new Event(CASE_UPDATED_EVENT)); }

export type ChatKind = 'ai' | 'human';
export type ChatRole = 'founder' | 'advisor';
export interface ChatFile { id: string; name: string }
export interface ChatSummary { id: string; case_id: string; kind: ChatKind; owner_role: ChatRole | null; title: string; created_at: string; updated_at: string; last_sender: ChatRole | 'ai' | null; last_content: string | null; last_at: string | null }
export interface ChatMessage { id: string; conversation_id: string; case_id: string; sender_type: ChatRole | 'ai'; content: string; files: ChatFile[]; created_at: string }

const casePath = (caseId: string): string => `/api/cases/${encodeURIComponent(caseId)}`;
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function listChats(caseId: string, kind: ChatKind, role: ChatRole, signal?: AbortSignal): Promise<ChatSummary[]> {
  return (await request(`${casePath(caseId)}/conversations?kind=${kind}&role=${role}`, { signal })).json() as Promise<ChatSummary[]>;
}

/** Start a conversation, optionally with its first (human) message. */
export async function createChat(caseId: string, kind: ChatKind, role: ChatRole, first?: { content: string; files: ChatFile[] }): Promise<ChatSummary> {
  return (await request(`${casePath(caseId)}/conversations`, json({ kind, role, message: first ? { role, ...first } : undefined }))).json() as Promise<ChatSummary>;
}

export async function listChatMessages(caseId: string, conversationId: string, role: ChatRole, signal?: AbortSignal): Promise<ChatMessage[]> {
  return (await request(`${casePath(caseId)}/conversations/${encodeURIComponent(conversationId)}/messages?role=${role}`, { signal })).json() as Promise<ChatMessage[]>;
}

/** Send a message to the other person in a human conversation. */
export async function sendChatMessage(caseId: string, conversationId: string, role: ChatRole, content: string, files: ChatFile[]): Promise<ChatMessage> {
  return (await request(`${casePath(caseId)}/conversations/${encodeURIComponent(conversationId)}/messages`, json({ role, content, files }))).json() as Promise<ChatMessage>;
}

export async function recentChatMessages(caseId: string, role: ChatRole, limit = 3, signal?: AbortSignal): Promise<ChatMessage[]> {
  return (await request(`${casePath(caseId)}/messages/recent?role=${role}&limit=${limit}`, { signal })).json() as Promise<ChatMessage[]>;
}
