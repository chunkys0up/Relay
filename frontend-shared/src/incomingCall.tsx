import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { callPanelOnScreen, requestJoinCall, useActiveCall } from './callPresence';
import { useRelay } from './context';
import './incomingCall.css';

const SIDEBAR_TAB_KEY = 'relay-sidebar-tab';

function initials(name: string): string {
  return name.split(' ').filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase();
}

/** A small corner notice, on every screen, when the other person is in a call this tab hasn't joined. */
export function IncomingCallNotice(): ReactNode {
  const { snapshot, role } = useRelay();
  const navigate = useNavigate();
  const { call, inCall } = useActiveCall(snapshot?.id ?? null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Leaving a call on purpose shouldn't immediately pop a notice for that same call.
  const wasInCall = useRef(false);
  useEffect(() => {
    if (wasInCall.current && !inCall && call) setDismissed(call.id);
    wasInCall.current = inCall;
  }, [inCall, call]);
  if (!snapshot || !call || inCall || dismissed === call.id) return null;
  const me = role === 'founder' ? snapshot.founder : snapshot.advisors[0];
  const caller = call.participants.find(person => person.actor_id !== me?.id && person.joined);
  if (!caller) return null;

  function join(): void {
    try { localStorage.setItem(SIDEBAR_TAB_KEY, 'call'); } catch { /* the call tab opens anyway when joining */ }
    if (callPanelOnScreen()) requestJoinCall();
    else navigate(`/${role}/call?join=1`);
  }

  return <div className="incoming-call" role="status" aria-live="polite">
    <span className="incoming-call-avatar" aria-hidden="true">{initials(caller.name)}</span>
    <div className="incoming-call-text">
      <strong>{caller.name} is calling</strong>
      <span>Call about {snapshot.company}</span>
    </div>
    <div className="incoming-call-actions">
      <button type="button" className="incoming-call-join" onClick={join}>Join</button>
      <button type="button" className="incoming-call-dismiss" onClick={() => setDismissed(call.id)}>Dismiss</button>
    </div>
  </div>;
}
