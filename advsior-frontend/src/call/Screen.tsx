import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, CallControls, Conversation, EmptyState, PageTitle, PacketPreview, Panel, ReviewControls, useRelay } from '@relay/shared';
import './call.css';

export default function Screen(): ReactNode {
  const { snapshot } = useRelay();
  if (!snapshot) return null;

  const packetId = snapshot.call?.packet_version_id ?? snapshot.current_packet_version_id;
  const packet = snapshot.packets.find((item) => item.id === packetId);

  if (!packet) {
    return (
      <section className="advisor-call-screen">
        <PageTitle title="Call" subtitle="Advisor and founder conversation" />
        <Panel className="advisor-call-empty">
          <EmptyState title="No shared packet is ready for a call">
            <p>Only a packet version explicitly shared with you can appear in this review.</p>
            <Link className="button button-outline" to="/advisor/reviews">View Reviews</Link>
          </EmptyState>
        </Panel>
      </section>
    );
  }

  return (
    <section className="advisor-call-screen">
      <div className="advisor-call-breadcrumb"><span>Call</span><span aria-hidden="true">/</span><span>Northstar Labs</span></div>
      <PageTitle title="Advisor call" subtitle="Review the shared packet with Alex Morgan." />
      <div className="call-grid advisor-call-layout">
        <section className="advisor-call-packet">
          <div className="advisor-call-section-heading"><div><h2>{packet.title}</h2><small>Exact packet version for this call</small></div><Badge>v{packet.version} · Synthetic</Badge></div>
          <PacketPreview packet={packet} />
          <ReviewControls packet={packet} />
        </section>
        <div className="advisor-call-side">
          <CallControls />
          <Panel title="AI support" className="advisor-call-ai-note">
            <Badge>Live suggestions off</Badge>
            <p>Relay does not suggest changes during this simulated call. Source-linked flags remain available in the packet review.</p>
          </Panel>
          <section className="advisor-call-messages" aria-label="Human messages">
            <div className="advisor-call-section-heading"><h2>Messages</h2><Badge>Human participants</Badge></div>
            <Conversation humanOnly />
          </section>
        </div>
      </div>
    </section>
  );
}