import { useState } from 'react';
import type { ReactNode } from 'react';
import { CaseSidebar, EmptyState, Panel, useCasePackets, useRelay } from '@relay/shared';
import { PacketDocument } from './PacketDocument';
import { PdfViewer } from './PdfViewer';
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

  return <section className="relay-call-screen founder-call-screen">
    <div className="relay-call-layout">
      <div className="relay-call-document-column">
        {ongoing && <header className="relay-call-header"><h1>Review with {snapshot.advisors[0].name}</h1><p>Shared document · Amazon Chime</p></header>}
        {selected ? <PacketDocument id="founder-call-document" packets={list} selected={selected} onSelect={setSelectedId} locked={ongoing} showReview/>
          : packets === null && !error ? <p role="status">Loading packets…</p>
          : <>
              <Panel><EmptyState title="No packet yet"><p>{error ?? 'Relay adds your planning packet here once it is prepared. You can still open uploaded PDFs below.'}</p></EmptyState></Panel>
              <PdfViewer/>
            </>}
        {!ongoing && selected && <p className="relay-call-document-note">Open the Call tab to review this version together.</p>}
      </div>
      <CaseSidebar onLiveCallChange={active => setLivePacketId(active && selected ? selected.id : null)}/>
    </div>
  </section>;
}
