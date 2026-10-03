import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CallControls, Collapsible, Conversation, EmptyState, PacketReviewPanel, PacketStatusBadge, Panel, useCasePackets, useRelay } from '@relay/shared';
import { PacketDocument } from '../../../client-frontend/src/call/PacketDocument';
import '../../../client-frontend/src/call/call.css';
import './call.css';

export default function Screen(): ReactNode {
  const { snapshot } = useRelay();
  const { packets, error } = useCasePackets();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [livePacketId, setLivePacketId] = useState<string | null>(null);
  if (!snapshot) return null;

  const ongoing = livePacketId !== null;
  const list = packets ?? [];
  const selected = list.find(packet => packet.id === (ongoing ? livePacketId : selectedId)) ?? list[0];

  if (!selected) return <section className="relay-call-screen advisor-call-screen">
    <Panel>{packets === null && !error ? <p role="status">Loading packets…</p>
      : <EmptyState title="No packet is ready for a call"><p>{error ?? `${snapshot.founder.name} has no planning packet yet.`}</p><Link className="button button-outline" to="/advisor/clients">View Clients</Link></EmptyState>}</Panel>
  </section>;

  return <section className="relay-call-screen advisor-call-screen">
    {ongoing && <header className="relay-call-header"><h1>Review with {snapshot.founder.name}</h1><p><Link to="/advisor/clients">Back to client</Link> · {snapshot.company}</p></header>}
    <div className="relay-call-layout">
      <div className="relay-call-document-column">
        <PacketDocument id="advisor-call-document" packets={list} selected={selected} onSelect={setSelectedId} locked={ongoing}/>
      </div>
      <div className="relay-call-right-column">
        <CallControls onLiveActiveChange={active => setLivePacketId(active ? selected.id : null)} />
        <section className="relay-call-review" aria-label={`Review packet v${selected.version}`}>
          <Collapsible id="advisor-call-review" title={<>Review v{selected.version} <PacketStatusBadge packet={selected}/></>}>
            <PacketReviewPanel packet={selected}/>
          </Collapsible>
        </section>
        {ongoing ? <section className="relay-call-messages" aria-label="Human messages"><h2>Messages</h2><Conversation humanOnly /></section>
          : <details className="relay-call-pre-message"><summary>Send a message to {snapshot.founder.name}</summary><Conversation humanOnly startNew /></details>}
      </div>
    </div>
  </section>;
}
