import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, CallControls, Conversation, EmptyState, PageTitle, PacketPreview, Panel, useRelay } from '@relay/shared';
import './call.css';

export default function Screen(): ReactNode {
  const { snapshot } = useRelay();
  if (!snapshot) return null;

  const packetId = snapshot.call?.packet_version_id ?? snapshot.current_packet_version_id;
  const packet = snapshot.packets.find((item) => item.id === packetId);

  if (!packet) {
    return (
      <section className="founder-call-screen">
        <PageTitle title="Call" subtitle="Founder and advisor conversation" />
        <Panel className="founder-call-empty">
          <EmptyState title="No packet is ready for a call">
            <p>A shared packet will appear here when one is available for review.</p>
            <Link className="button button-outline" to="/founder/documents">View Documents</Link>
          </EmptyState>
        </Panel>
      </section>
    );
  }

  return (
    <section className="founder-call-screen">
      <div className="founder-call-breadcrumb"><span>Call</span><span aria-hidden="true">/</span><span>{packet.title} · v{packet.version}</span></div>
      <PageTitle title="Founder call" subtitle="Review the shared packet with Maya." />
      <div className="call-grid founder-call-layout">
        <section className="founder-call-packet">
          <div className="founder-call-section-heading"><h2>Packet under review</h2><Badge>v{packet.version} · Synthetic</Badge></div>
          <PacketPreview packet={packet} />
        </section>
        <div className="founder-call-side">
          <CallControls />
          <Panel title="AI support" className="founder-call-ai-note">
            <Badge>Live suggestions off</Badge>
            <p>Relay does not make suggestions during this simulated call. Source-linked details remain available in the packet.</p>
          </Panel>
          <section className="founder-call-messages" aria-label="Human messages">
            <div className="founder-call-section-heading"><h2>Messages</h2><Badge>Human participants</Badge></div>
            <Conversation humanOnly />
          </section>
        </div>
      </div>
    </section>
  );
}