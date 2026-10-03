import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, CallControls, Conversation, EmptyState, PacketPreview, Panel, ReviewControls, useRelay } from '@relay/shared';
import './call.css';

export default function Screen(): ReactNode {
  const { snapshot } = useRelay();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (!snapshot) return null;

  const available = snapshot.packets.filter(packet => snapshot.grants.some(grant =>
    grant.advisor_id === snapshot.advisors[0].id &&
    grant.packet_version_id === packet.id &&
    grant.packet_hash === packet.hash
  ));
  const call = snapshot.call;
  const ongoing = Boolean(call && !['ended', 'failed'].includes(call.state));
  const selected = ongoing
    ? available.find(packet => packet.id === call?.packet_version_id)
    : available.find(packet => packet.id === selectedId) ??
      available.find(packet => packet.id === snapshot.current_packet_version_id) ??
      available.at(-1);

  if (!selected) return <section className="relay-call-screen advisor-call-screen">
    <header className="relay-call-header"><h1>Call</h1><p>Get ready before you connect.</p></header>
    <Panel><EmptyState title="No shared document is ready for a call"><p>Alex must share a packet version before it can appear here.</p><Link className="button button-outline" to="/advisor/clients">View Clients</Link></EmptyState></Panel>
  </section>;

  return <section className="relay-call-screen advisor-call-screen">
    <header className="relay-call-header">{ongoing
      ? <><h1>Review with {snapshot.founder.name}</h1><p><Link to="/advisor/clients">Back to client</Link> · {snapshot.company}</p></>
      : <><h1>Call</h1><p>Get ready before you connect.</p></>}
    </header>
    <div className="relay-call-layout">
      <div className="relay-call-document-column">
        <div className="relay-call-document-heading">
          <h2>Document for this call</h2>
          {!ongoing && available.length > 1 && <label className="relay-call-packet-picker">Shared document<select aria-label="Document for this call" value={selected.id} onChange={event => setSelectedId(event.target.value)}>{available.map(packet => <option value={packet.id} key={packet.id}>{packet.title} · v{packet.version}</option>)}</select></label>}
          <Badge tone="success">Already shared</Badge>
        </div>
        <PacketPreview packet={selected} />
        <details className="relay-call-review-actions"><summary>Review actions for v{selected.version}</summary><ReviewControls packet={selected}/></details>
      </div>
      <div className="relay-call-right-column">
        <CallControls packet={selected} />
        {ongoing ? <section className="relay-call-messages" aria-label="Human messages"><h2>Messages</h2><Conversation humanOnly /></section>
          : <details className="relay-call-pre-message"><summary>Send a message to {snapshot.founder.name}</summary><Conversation humanOnly /></details>}
      </div>
    </div>
  </section>;

}
