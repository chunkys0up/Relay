import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, CallControls, Collapsible, Conversation, EmptyState, PacketPreview, Panel, ReviewControls, useRelay } from '@relay/shared';
import type { PacketVersion } from '@relay/shared';
import { Tabs } from '../../../frontend-shared/src/tabs';
import { PdfViewer } from '../../../client-frontend/src/call/PdfViewer';
import '../../../client-frontend/src/call/call.css';
import './call.css';

function reviewStatus(packet: PacketVersion): { label: string; tone: 'neutral' | 'attention' | 'success' } {
  if (packet.status === 'approved') return { label: 'Approved', tone: 'success' };
  if (packet.status === 'questions_returned') return { label: 'Questions returned', tone: 'attention' };
  if (packet.status === 'in_review') return { label: 'Review required', tone: 'attention' };
  return { label: 'Draft', tone: 'neutral' };
}

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

  if (!selected) return <section className="relay-call-screen advisor-call-screen">
    <Panel><EmptyState title="No shared document is ready for a call"><p>Alex must share a packet version before it can appear here.</p><Link className="button button-outline" to="/advisor/clients">View Clients</Link></EmptyState></Panel>
  </section>;

  return <section className="relay-call-screen advisor-call-screen">
    {ongoing && <header className="relay-call-header"><h1>Review with {snapshot.founder.name}</h1><p><Link to="/advisor/clients">Back to client</Link> · {snapshot.company}</p></header>}
    <div className="relay-call-layout">
      <div className="relay-call-document-column">
        <div className="relay-call-document-heading">
          {!ongoing && available.length > 1 && <label className="relay-call-packet-picker">Shared document<select aria-label="Document for this call" value={selected.id} onChange={event => setSelectedId(event.target.value)}>{available.map(packet => <option value={packet.id} key={packet.id}>{packet.title} · v{packet.version}</option>)}</select></label>}
          <Badge tone="success">Already shared</Badge>
        </div>
        <Tabs id="advisor-call-document" label="Document view" items={[{ id: 'pdf', label: 'PDF' }, { id: 'summary', label: 'Packet summary' }]} value={documentView} onChange={value => setDocumentView(value as 'pdf' | 'summary')}/>
        <div id={`advisor-call-document-${documentView}-panel`} role="tabpanel" aria-labelledby={`advisor-call-document-${documentView}-tab`}>
          {documentView === 'pdf' ? <PdfViewer /> : <PacketPreview packet={selected} />}
        </div>
      </div>
      <div className="relay-call-right-column">
        <CallControls onLiveActiveChange={active => setLivePacketId(active ? selected.id : null)} />
        <section className="relay-call-review" aria-label={`Review packet v${selected.version}`}>
          <Collapsible id="advisor-call-review" title={<>Review v{selected.version} <Badge tone={reviewStatus(selected).tone}>{reviewStatus(selected).label}</Badge></>}>
            <ReviewControls packet={selected}/>
          </Collapsible>
        </section>
        {ongoing ? <section className="relay-call-messages" aria-label="Human messages"><h2>Messages</h2><Conversation humanOnly /></section>
          : <details className="relay-call-pre-message"><summary>Send a message to {snapshot.founder.name}</summary><Conversation humanOnly startNew /></details>}
      </div>
    </div>
  </section>;

}
