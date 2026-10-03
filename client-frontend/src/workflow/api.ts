export type PacketField = 'company_name' | 'founder_name' | 'business_summary' | 'annual_revenue' | 'cash_reserve' | 'period';
export interface Evidence { source_id: string; source_hash: string; page: number; quote: string }
export interface WorkflowSource {
  id: string; name: string; hash: string; excerpt_count: number; mime_type?: string;
  extraction_status?: string; interpretation_status?: string;
  status_detail?: string | null;
  relationship_suggestion?: { related_source_id: string; reason: string } | null;
  relationship?: { related_source_id: string; decision: 'revision' | 'separate' } | null;
}
export interface WorkflowTask {
  id: string; key?: string; title: string; state: string; detail?: string; order?: number;
  dependencies?: string[]; responsible_party?: string; blocking_reason?: string | null;
  completion_condition?: string;
}
export interface WorkflowFact { value: string | null; state: string; candidates: { value: string; evidence: Evidence[] }[]; confirmed_by: string | null }
export interface PdfAction {
  verification?: { passed: boolean; hash: string; mode: string; checks: string[] };
  id: string; status: 'pending' | 'applied' | 'dismissed' | 'superseded';
  created_revision: number; hash: string; fields: Record<PacketField, string>;
  changes: { field: PacketField; value: string; evidence: Evidence[] }[];
  base_packet_id: string | null; template_id: string | null; version: number;
}
export interface WorkflowCase {
  id: string; company: string; goal: string; revision: number; analysis_required?: boolean; ui_state: string; status: string;
  sources: WorkflowSource[];
  facts: Record<PacketField, WorkflowFact>;
  flags: { field: string; detail: string; kind: string; question?: string }[];
  tasks: WorkflowTask[];
  messages: { id: string; author: string; text: string; created_at: string }[];
  packets: { id: string; version: number; hash: string; created_at: string }[];
  pdf_actions?: PdfAction[];
  templates?: { id: string; name: string; fields: string[] }[];
  jobs: { id: string; status: string; error?: string }[];
}
export interface WorkflowSession { provider: string; mode: 'live' | 'unconfigured' | 'simulated'; csrf_token: string }
export class WorkflowRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}
let csrfToken = '';
export function setWorkflowCsrf(value: string): void { csrfToken = value; }

export async function workflowRequest<T>(path: string, options: { method?: string; body?: unknown; file?: FormData; signal?: AbortSignal; key?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-CSRF-Token': csrfToken };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET') headers['Idempotency-Key'] = options.key ?? crypto.randomUUID();
  let response: Response;
  try {
    response = await fetch('/api/workflow' + path, { method: options.method ?? 'GET', headers, credentials: 'same-origin', signal: options.signal, body: options.file ?? (options.body === undefined ? undefined : JSON.stringify(options.body)) });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error('The packet backend could not be reached. Start the backend on port 8000, then retry.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { detail?: unknown; error?: { code?: string } } | null;
    const code = typeof data?.detail === 'string' ? data.detail : data?.error?.code;
    throw new WorkflowRequestError(code ? `Request stopped: ${code.replaceAll('_', ' ').toLowerCase()}.` : `The backend could not complete this request (${response.status}).`, response.status, code);
  }
  return response.json() as Promise<T>;
}

// StrictMode and simultaneous views must share session creation: a late Set-Cookie
// from a discarded request would otherwise mismatch the visible CSRF token.
let initializing: Promise<WorkflowSession> | null = null;
export function initializeWorkflowSession(): Promise<WorkflowSession> {
  if (!initializing) {
    initializing = workflowRequest<WorkflowSession>('/session').then(session => {
      setWorkflowCsrf(session.csrf_token);
      return session;
    }).finally(() => { initializing = null; });
  }
  return initializing;
}
