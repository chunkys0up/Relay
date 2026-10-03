import type { Role } from './types';
import { initializeWorkflowSession, workflowCsrfToken } from '../../client-frontend/src/workflow/api';

// Real FastAPI backend (see backend/app/api/routes/calls.py). Separate from the
// simulated RelayAdapter: nothing here touches the local mock case state.
export const API_BASE: string = import.meta.env.VITE_API_URL ?? '';

export type LiveCallState = 'ringing' | 'connecting' | 'connected' | 'ended' | 'failed';
export interface LiveCallSession {
  id: string;
  case_id: string;
  state: LiveCallState;
  participants: { actor_id: string; name: string; role: Role; joined: boolean; muted: boolean }[];
  capture: 'off';
}
// Minimal Chime client join config (short-lived; never log or persist).
export interface LiveJoinConfig { call: LiveCallSession; meeting: unknown; attendee: unknown }

export class CallsApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'CallsApiError'; }
}

async function post<T>(path: string, body: object, signal?: AbortSignal, keepalive = false): Promise<T> {
  let response: Response;
  try {
    const fixture = import.meta.env.MODE === 'test' || import.meta.env.VITE_PACKET_DATA_MODE === 'fixture';
    if (!fixture && !workflowCsrfToken()) await initializeWorkflowSession();
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(!fixture ? { 'X-CSRF-Token': workflowCsrfToken() } : {}) },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal,
      keepalive,
    });
  } catch {
    throw new CallsApiError(0, `Cannot reach the backend at ${API_BASE || 'this origin'}. Is it running?`);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    const detail = typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status})`;
    throw new CallsApiError(response.status, detail);
  }
  return response.json() as Promise<T>;
}

const base = (caseId: string): string => `/api/cases/${encodeURIComponent(caseId)}/calls`;

export const callsApi = {
  create: (caseId: string, signal?: AbortSignal) => post<LiveCallSession>(base(caseId), {}, signal),
  join: (caseId: string, callId: string, joinId: string, signal?: AbortSignal) =>
    post<LiveJoinConfig>(`${base(caseId)}/${encodeURIComponent(callId)}/join`, { join_id: joinId }, signal),
  leave: (caseId: string, callId: string, joinId: string) =>
    post<LiveCallSession>(`${base(caseId)}/${encodeURIComponent(callId)}/leave`, { join_id: joinId }, undefined, true),
  end: (caseId: string, callId: string) =>
    post<LiveCallSession>(`${base(caseId)}/${encodeURIComponent(callId)}/end`, {}),
};

export type ClientLogEvent =
  | 'start_clicked' | 'create_ok' | 'join_ok' | 'sdk_loaded' | 'mic_started' | 'no_mic'
  | 'camera_started' | 'no_camera' | 'session_started' | 'local_tile' | 'remote_tile'
  | 'remote_tile_removed' | 'chime_stopped' | 'mute' | 'unmute' | 'camera_on' | 'camera_off'
  | 'leave' | 'end_for_everyone' | 'error';

/** Fire-and-forget progress event for the backend log. Never throws; never send secrets. */
export function logClient(event: ClientLogEvent, role: Role, callId?: string | null, detail?: string): void {
  void fetch(`${API_BASE}/api/client-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, role, call_id: callId ?? null, detail: detail?.slice(0, 200) ?? null }),
    keepalive: true,
  }).catch(() => undefined);
}
