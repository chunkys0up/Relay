import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, CallControls, Conversation, EmptyState, PacketPreview, Panel, useRelay } from '@relay/shared';
import { Tabs } from '../../../frontend-shared/src/tabs';
import { PdfViewer } from './PdfViewer';
import './call.css';

export default function Screen(): ReactNode {
  const { snapshot } = useRelay();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [livePacketId, setLivePacketId] = useState<string | null>(null);
  const [documentView, setDocumentView] = useState<'pdf' | 'summary'>('pdf');
  if (!snapshot) return null;

  const available = snapshot.packets.filter(packet => snapshot.grants.some(grant =>
    grant.advisor_id === snapshot.advisors[0].id &&
    grant.packet_version_id === packet.id &&
    grant.packet_hash === packet.hash
  ));
  const ongoing = livePacketId !== null;
  const selected = ongoing
    ? available.find(packet => packet.id === livePacketId)
    : available.find(packet => packet.id === selectedId) ??
      available.find(packet => packet.id === snapshot.current_packet_version_id) ??
      available.at(-1);

  if (!selected) return <section className="relay-call-screen founder-call-screen">
    <Panel><EmptyState title="No shared document is ready for a call"><p>Share the exact packet version with Maya before inviting her.</p><Link className="button button-outline" to="/founder/documents">View Documents</Link></EmptyState></Panel>
  </section>;

  return <section className="relay-call-screen founder-call-screen">
    {ongoing && <header className="relay-call-header"><h1>Review with {snapshot.advisors[0].name}</h1><p>Shared document · Amazon Chime</p></header>}
    <div className="relay-call-layout">
      <div className="relay-call-document-column">
        <div className="relay-call-document-heading">
          {!ongoing && available.length > 1 && <label className="relay-call-packet-picker">Shared document<select aria-label="Document for this call" value={selected.id} onChange={event => setSelectedId(event.target.value)}>{available.map(packet => <option value={packet.id} key={packet.id}>{packet.title} · v{packet.version}</option>)}</select></label>}
          <Badge tone="success">Already shared</Badge>
        </div>
        <Tabs id="founder-call-document" label="Document view" items={[{ id: 'pdf', label: 'PDF' }, { id: 'summary', label: 'Packet summary' }]} value={documentView} onChange={value => setDocumentView(value as 'pdf' | 'summary')}/>
        <div id={`founder-call-document-${documentView}-panel`} role="tabpanel" aria-labelledby={`founder-call-document-${documentView}-tab`}>
          {documentView === 'pdf' ? <PdfViewer /> : <PacketPreview packet={selected} />}
        </div>
        {!ongoing && <p className="relay-call-document-note">Choose a connection to review this shared version together.</p>}
      </div>
      <div className="relay-call-right-column">
        <CallControls onLiveActiveChange={active => setLivePacketId(active ? selected.id : null)} />
        {ongoing ? <section className="relay-call-messages" aria-label="Human messages"><h2>Messages</h2><Conversation humanOnly /></section>
          : <details className="relay-call-pre-message"><summary>Send a message to {snapshot.advisors[0].name}</summary><Conversation humanOnly startNew /></details>}
      </div>
    </div>
  </section>;

}
