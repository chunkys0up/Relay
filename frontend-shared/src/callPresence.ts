import { useEffect, useSyncExternalStore } from 'react';
import { callsApi } from './callsApi';
import type { LiveCallSession } from './callsApi';

// One shared view of the case's open call, polled while anything on screen is watching it,
// plus whether this tab is in that call. Drives the call button label and the incoming-call notice.

const POLL_MS = 4000;
const JOIN_EVENT = 'relay:join-call';

interface Snapshot { caseId: string | null; call: LiveCallSession | null; loaded: boolean; inCall: boolean; panels: number }
let snapshot: Snapshot = { caseId: null, call: null, loaded: false, inCall: false, panels: 0 };
const listeners = new Set<() => void>();
let timer: number | null = null;

function update(next: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...next };
  listeners.forEach(listener => listener());
}

/** Fetch the open call now instead of waiting for the next poll. */
export async function refreshActiveCall(): Promise<void> {
  const caseId = snapshot.caseId;
  if (!caseId) return;
  try {
    const call = await callsApi.active(caseId);
    if (snapshot.caseId === caseId) update({ call, loaded: true });
  } catch { /* keep the last known state; the next poll retries */ }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshActiveCall(); }, POLL_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) { window.clearInterval(timer); timer = null; }
  };
}

/** The case's open call, polled every few seconds, and whether this tab has joined it. */
export function useActiveCall(caseId: string | null): Snapshot {
  const current = useSyncExternalStore(subscribe, () => snapshot);
  useEffect(() => {
    if (caseId && caseId !== snapshot.caseId) { update({ caseId, call: null, loaded: false }); void refreshActiveCall(); }
  }, [caseId]);
  return current;
}

export function setInCall(inCall: boolean): void {
  if (snapshot.inCall !== inCall) update({ inCall });
  void refreshActiveCall();
}

/** Call panels on screen register themselves, so "Join" can use one in place instead of navigating. */
export function registerCallPanel(): () => void {
  update({ panels: snapshot.panels + 1 });
  return () => update({ panels: snapshot.panels - 1 });
}

export function callPanelOnScreen(): boolean { return snapshot.panels > 0; }

/** Ask the call panel on screen to join the open call (it also brings its tab forward). */
export function requestJoinCall(): void { window.dispatchEvent(new Event(JOIN_EVENT)); }

export function onJoinRequest(handler: () => void): () => void {
  window.addEventListener(JOIN_EVENT, handler);
  return () => window.removeEventListener(JOIN_EVENT, handler);
}
