import type { ReactNode } from 'react';
import { useRelay } from './context';
import { Badge, Button, Panel } from './ui';

export function CallControls(): ReactNode {
  const { snapshot, role, busy, run } = useRelay();
  if (!snapshot) return null;
  const actor = role === 'founder' ? snapshot.founder : snapshot.advisors[0];
  const other = role === 'founder' ? snapshot.advisors[0] : snapshot.founder;
  const call = snapshot.call;
  const active = Boolean(call && !['ended', 'failed'].includes(call.state));
  const packetId = active ? call?.packet_version_id : snapshot.current_packet_version_id;
  const packet = snapshot.packets.find(item => item.id === packetId);
  const me = call?.participants.find(person => person.actor.id === actor.id);
  return <>
    <Panel title="Video call" className="call-controls-video">
      <div className="row"><Badge tone="attention">Simulated call · No live media</Badge><span>{call?.state ?? 'No invitation'}</span></div>
      <div className="video-grid">{[snapshot.founder, ...snapshot.advisors].map(person =>
        <div className="video-placeholder" key={person.id}>
          <span className="video-avatar">{person.name.split(' ').map(part => part[0]).join('')}</span>
          <span>Video preview unavailable</span>
          <strong>{person.name} · {person.role} · Human</strong>
        </div>,
      )}</div>
      <div className="row wrap">
        {!active ? <Button disabled={busy || !packet} onClick={() => {
          if (packet) void run({ kind: 'invite', expected_revision: snapshot.revision, packet_version_id: packet.id, packet_hash: packet.hash, recipient_id: other.id });
        }}>Simulate invitation to {other.name}</Button> : <>
          {!me?.accepted && <Button disabled={busy} onClick={() => { if (call) void run({ kind: 'call_action', expected_revision: call.revision, action: 'accept' }); }}>Accept simulated invitation</Button>}
          <Button variant="outline" disabled={busy} onClick={() => { if (call) void run({ kind: 'call_action', expected_revision: call.revision, action: me?.muted ? 'unmute' : 'mute' }); }}>{me?.muted ? 'Unmute' : 'Mute'} (simulated)</Button>
          <Button variant="outline" disabled={busy} onClick={() => { if (call) void run({ kind: 'call_action', expected_revision: call.revision, action: me?.accepted ? 'end' : 'decline' }); }}>{me?.accepted ? 'End' : 'Decline'} simulated call</Button>
        </>}
      </div>
      <p className="muted call-media-note">Camera, microphone and Chime connection are unavailable in this simulation.</p>
    </Panel>
    <Panel title="Separate capture consent" className="capture-consent">
      <label className="check-row"><input type="checkbox" aria-label="I consent to capture for after-call AI notes (simulated)" checked={me?.capture_consent === 'granted'} disabled={busy || !active} onChange={event => {
        if (call) void run({ kind: 'consent', expected_revision: call.revision, consent: event.target.checked ? 'granted' : 'withdrawn' });
      }} />I allow capture for after-call AI notes · Simulated</label>
      <div className="consent-participants">{call?.participants.map(person => <span key={person.actor.id}>{person.actor.name}: <Badge>{person.capture_consent.replaceAll('_', ' ')}</Badge></span>)}</div>
      <p role="status">Capture: {call?.capture ?? 'off'} · Processing: {call?.processing ?? 'not_started'}</p>
      <details><summary>Everyone must consent separately</summary><p>Joining and messaging never enable capture. No recording or transcription occurs in this mock, even if everyone consents. Withdrawal disables capture; real stop results must come from the backend.</p></details>
    </Panel>
  </>;
}
