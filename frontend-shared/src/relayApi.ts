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
export async function streamChat(sessionId: string, message: string, onChunk: (text: string) => void, options: { signal?: AbortSignal; documentIds?: string[]; caseId?: string } = {}): Promise<string> {
  const { signal, documentIds = [], caseId } = options;
  const response = await request('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId, document_ids: documentIds, case_id: caseId }),
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

export async function listActivity(caseId: string, limit = 20, signal?: AbortSignal): Promise<ActivityEntry[]> {
  return (await request(`/api/cases/${encodeURIComponent(caseId)}/activity?limit=${limit}`, { signal })).json() as Promise<ActivityEntry[]>;
}

/** Fired after anything that can change the case's checklist, activity or documents (AI replies, uploads, ticks). */
export const CASE_UPDATED_EVENT = 'relay:case-updated';
export function announceCaseUpdate(): void { window.dispatchEvent(new Event(CASE_UPDATED_EVENT)); }
