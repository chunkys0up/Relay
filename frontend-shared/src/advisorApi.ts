// Advisor requests stay on the app origin so the scoped HttpOnly cookie and
// CSRF bootstrap use the same proxy; no generic chat/document endpoint is used.
const ADVISOR_API_BASE: string = import.meta.env.VITE_ADVISOR_API_URL ?? '';

export interface AdvisorVersion {
  id: string;
  version: number;
  hash: string;
  title: string;
  source_ids: string[];
}

export interface AdvisorSession {
  mode: string;
  provider: string;
  csrf_token: string;
  workspace: {
    case_id: string;
    company: string;
    advisor: { id: string; name: string };
    versions: AdvisorVersion[];
  };
}

export interface AdvisorCitation {
  source_id: string;
  source_hash: string;
  version_id: string;
  page?: number;
  field?: string;
  quote?: string;
  label: string;
  url: string;
}

export interface AdvisorMessage {
  id: string;
  request_key?: string;
  role: 'user' | 'assistant';
  text: string;
  created_at: string;
  citations: AdvisorCitation[];
  kind?: 'answer' | 'unknown' | 'conflict' | 'comparison' | 'followup_draft';
  draft_questions?: string[];
}

export interface AdvisorConversation {
  conversation_id: string;
  case_id: string;
  versions: { id: string; hash: string }[];
  messages: AdvisorMessage[];
}

export class AdvisorApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AdvisorApiError';
  }
}

const casePath = (caseId: string): string => `/api/advisor/cases/${encodeURIComponent(caseId)}`;
let bootstrapRequest: Promise<AdvisorSession> | null = null;

async function jsonRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ADVISOR_API_BASE}${path}`, { credentials: 'include', ...init });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new AdvisorApiError(0, 'CONNECTION_FAILED', 'Cannot reach the advisor backend.', true);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: unknown; message?: unknown; retryable?: unknown }; detail?: unknown } | null;
    const apiError = body?.error;
    throw new AdvisorApiError(
      response.status,
      typeof apiError?.code === 'string' ? apiError.code : 'REQUEST_FAILED',
      typeof apiError?.message === 'string' ? apiError.message : typeof body?.detail === 'string' ? body.detail : `Advisor request failed (${response.status}).`,
      apiError?.retryable === true,
    );
  }
  try {
    return await response.json() as T;
  } catch {
    throw new AdvisorApiError(response.status, 'MALFORMED_RESPONSE', 'The advisor backend returned an unreadable response.', true);
  }
}

function postHeaders(csrfToken: string, key: string): HeadersInit {
  return { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, 'Idempotency-Key': key };
}

export const advisorApi = {
  session: (_signal?: AbortSignal) => {
    // Two panes mount together on a cold direct URL. One bootstrap must set
    // their shared cookie and CSRF token, or they can become different actors.
    if (!bootstrapRequest) {
      bootstrapRequest = jsonRequest<AdvisorSession>('/api/advisor/session').finally(() => { bootstrapRequest = null; });
    }
    return bootstrapRequest;
  },
  conversations: (caseId: string, versions: AdvisorVersion[], signal?: AbortSignal) => {
    const query = new URLSearchParams({ version_id: versions[0].id, version_hash: versions[0].hash });
    if (versions[1]) { query.set('compare_id', versions[1].id); query.set('compare_hash', versions[1].hash); }
    return jsonRequest<{ items: AdvisorConversation[] }>(`${casePath(caseId)}/conversations?${query}`, { signal });
  },
  createConversation: (caseId: string, versions: AdvisorVersion[], csrfToken: string, key: string, signal?: AbortSignal) =>
    jsonRequest<AdvisorConversation>(`${casePath(caseId)}/conversations`, {
      method: 'POST', headers: postHeaders(csrfToken, key),
      body: JSON.stringify({ versions: versions.map(({ id, hash }) => ({ id, hash })) }), signal,
    }),
  getConversation: (caseId: string, conversationId: string, signal?: AbortSignal) =>
    jsonRequest<AdvisorConversation>(`${casePath(caseId)}/conversations/${encodeURIComponent(conversationId)}`, { signal }),
  send: (caseId: string, conversationId: string, text: string, csrfToken: string, key: string, signal?: AbortSignal) =>
    jsonRequest<AdvisorConversation>(`${casePath(caseId)}/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST', headers: postHeaders(csrfToken, key), body: JSON.stringify({ text }), signal,
    }),
  packetText: async (caseId: string, version: AdvisorVersion, signal?: AbortSignal): Promise<string> => {
    const path = advisorPacketHref(caseId, version);
    let response: Response;
    try { response = await fetch(path, { credentials: 'include', signal }); }
    catch (error) {
      if (signal?.aborted) throw error;
      throw new AdvisorApiError(0, 'CONNECTION_FAILED', 'Cannot reach the advisor packet preview.', true);
    }
    if (!response.ok) throw new AdvisorApiError(response.status, 'PREVIEW_FAILED', `Server packet preview failed (${response.status}).`, response.status >= 500);
    return response.text();
  },
};

export function advisorPacketHref(caseId: string, version: AdvisorVersion): string {
  const path = `${casePath(caseId)}/packets/${encodeURIComponent(version.id)}/preview?packet_hash=${encodeURIComponent(version.hash)}`;
  return new URL(path, ADVISOR_API_BASE || window.location.origin).href;
}

/** Only the backend's scoped advisor preview endpoints may become clickable citations. */
export function advisorCitationHref(citation: AdvisorCitation, caseId: string, versions: AdvisorVersion[]): string | null {
  const version = versions.find(item => item.id === citation.version_id);
  if (!version || !citation.source_hash) return null;
  let url: URL;
  try { url = new URL(citation.url, ADVISOR_API_BASE || window.location.origin); } catch { return null; }
  const base = new URL(ADVISOR_API_BASE || window.location.origin, window.location.origin);
  if (citation.source_id === version.id && citation.source_hash === version.hash) {
    const packetPath = `${casePath(caseId)}/packets/${encodeURIComponent(version.id)}/preview`;
    return url.origin === base.origin && url.pathname === packetPath && url.searchParams.get('packet_hash') === version.hash ? url.href : null;
  }
  if (!version.source_ids.includes(citation.source_id)) return null;
  const expectedPath = `${casePath(caseId)}/sources/${encodeURIComponent(citation.source_id)}/preview`;
  if (url.origin !== base.origin || url.pathname !== expectedPath) return null;
  if (url.searchParams.get('version_id') !== version.id || url.searchParams.get('packet_hash') !== version.hash || url.searchParams.get('source_hash') !== citation.source_hash) return null;
  return url.href;
}
