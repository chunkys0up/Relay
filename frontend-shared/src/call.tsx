import { useState, type ReactNode } from 'react';
import { LiveCall } from './liveCall';
import { useRelay } from './context';
import type { Actor, PacketVersion } from './types';
import { Badge, Button } from './ui';
import './call.css';

function initials(name: string): string {
  return name.split(' ').map(part => part[0]).join('');
}

function PersonTile({ person, self, muted }: { person: Actor; self: boolean; muted?: boolean }): ReactNode {
  return <div className="relay-call-person">
    <span className={'relay-call-avatar ' + (person.role === 'advisor' ? 'advisor' : 'founder')}>{initials(person.name)}</span>
    <strong>{person.name}{self ? ' (You)' : ''}</strong>
    <span>{self && muted ? 'Microphone muted · simulated' : 'Camera off · no live media'}</span>
  </div>;
}

export function CallControls({ packet, onLiveActiveChange }: { packet: PacketVersion; onLiveActiveChange?: (active: boolean) => void }): ReactNode {
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [liveActive, setLiveActive] = useState(false);
  const { snapshot } = useRelay();
  const demoActive = Boolean(snapshot?.call && !['ended', 'failed'].includes(snapshot.call.state));
  return <>
    <label className="relay-call-mode">Call connection
      <select aria-label="Call connection" value={mode} disabled={liveActive || demoActive} onChange={event => setMode(event.target.value as 'demo' | 'live')}>
        <option value="demo">Demo preview · simulated</option>
        <option value="live">Amazon Chime · live media</option>
      </select>
    </label>
    {mode === 'live' && <p className="relay-call-disclaimer">Chime carries live audio and video. Documents, messages and reviews remain local demo data.</p>}
    {mode === 'live' ? <LiveCall onActiveChange={active => { setLiveActive(active); onLiveActiveChange?.(active); }} /> : <DemoCallControls packet={packet} />}
  </>;
}

function DemoCallControls({ packet }: { packet: PacketVersion }): ReactNode {
  const { snapshot, role, busy, run } = useRelay();
  if (!snapshot) return null;
  const actor = role === 'founder' ? snapshot.founder : snapshot.advisors[0];
  const other = role === 'founder' ? snapshot.advisors[0] : snapshot.founder;
  const call = snapshot.call;
  const ongoing = Boolean(call && !['ended', 'failed'].includes(call.state));
  const me = call?.participants.find(person => person.actor.id === actor.id);
  const incoming = call?.state === 'ringing' && !me?.accepted;
  const outgoing = call?.state === 'ringing' && me?.accepted;
  const current = packet.id === snapshot.current_packet_version_id;
  const shared = snapshot.grants.some(grant =>
    grant.advisor_id === snapshot.advisors[0].id &&
    grant.packet_version_id === packet.id &&
    grant.packet_hash === packet.hash
  );
  const canInvite = current && shared;
  const act = (action: 'accept' | 'decline' | 'mute' | 'unmute' | 'end'): void => {
    if (call) void run({ kind: 'call_action', expected_revision: call.revision, action });
  };
  return <section className="relay-call-side-panel" aria-label="Call controls">
    {ongoing ? <>
      <div className="relay-call-side-title"><h2>Call · Demo preview</h2><Badge tone="attention">{call?.state === 'ringing' ? 'Invitation pending' : call?.state === 'connecting' ? 'Connecting' : 'Connected state'}</Badge></div>
      <div className="relay-call-people">
        <PersonTile person={actor} self muted={me?.muted} />
        <PersonTile person={other} self={false} />
      </div>
      <p className="relay-call-disclaimer">Simulated call state. No audio or video connection is available.</p>
      {incoming && <div className="relay-call-invitation"><p>{other.name} invited you to review this packet.</p><div className="relay-call-action-row"><Button disabled={busy} onClick={() => act('accept')}>Accept invitation</Button><Button variant="outline" disabled={busy} onClick={() => act('decline')}>Decline</Button></div></div>}
      {outgoing && <p className="relay-call-status" role="status">Waiting for {other.name} to accept the simulated invitation.</p>}
      <div className="relay-call-round-actions">
        <Button variant="outline" disabled={busy || incoming} onClick={() => act(me?.muted ? 'unmute' : 'mute')} aria-label={me?.muted ? 'Unmute simulated microphone' : 'Mute simulated microphone'}>{me?.muted ? '♩' : '♬'}<span>{me?.muted ? 'Unmute' : 'Mute'}<small>Simulated</small></span></Button>
        <Button variant="outline" disabled aria-label="Camera unavailable in demo">▣<span>Camera<small>Unavailable</small></span></Button>
        {!incoming && <Button className="relay-call-end" disabled={busy} onClick={() => act('end')}>{outgoing ? 'Cancel invite' : 'End call'}</Button>}
      </div>
    </> : <>
      <h2>Ready to call?</h2>{call?.state==='failed'&&<p role="alert">The simulated call failed. You can send a new invitation.</p>}{call?.state==='ended'&&<p className="relay-call-disclaimer" role="status">The previous simulated call ended.</p>}
      <div className="relay-call-recipient"><span className={'relay-call-avatar ' + (other.role === 'advisor' ? 'advisor' : 'founder')}>{initials(other.name)}</span><div><strong>{other.name}</strong><span>{role === 'founder' ? 'Your financial advisor' : 'Client · ' + snapshot.company}</span></div></div>
      <div className="relay-call-preview-heading"><h3>Your camera preview</h3><span>Preview only</span></div>
      <div className="relay-call-self-preview"><span className={'relay-call-avatar large ' + (actor.role === 'advisor' ? 'advisor' : 'founder')}>{initials(actor.name)}</span><strong>{actor.name} · You</strong><span>Your camera is off</span></div>
      <p className="relay-call-disclaimer">No camera or microphone is connected in this demo.</p>
      <div className="relay-call-device-grid">
        <Button variant="outline" disabled>Camera off</Button><Button variant="outline" disabled>Microphone muted</Button>
        <label>Camera<select disabled aria-label="Camera device"><option>Unavailable in demo</option></select></label>
        <label>Microphone<select disabled aria-label="Microphone device"><option>Unavailable in demo</option></select></label>
      </div>
      <button className="relay-call-test-speaker" type="button" disabled>Test speaker · unavailable in demo</button>
      <div className="relay-call-invite">
        <Button disabled={busy || !canInvite} onClick={() => { void run({ kind: 'invite', expected_revision: snapshot.revision, packet_version_id: packet.id, packet_hash: packet.hash, recipient_id: other.id }); }}>Call {other.name}</Button>
        <p>{canInvite ? other.name + ' will receive a simulated invitation in this browser.' : current ? 'Share this exact packet before inviting ' + other.name + '.' : 'Select the current shared packet to start a call.'}</p>
        <span>You’re not in a call yet.</span>
      </div>
    </>}
  </section>;
}
