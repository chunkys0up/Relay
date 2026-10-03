import { useState } from 'react';
import type { ReactNode } from 'react';
import { PacketReviewNotice, PacketStatusBadge, PacketSummary } from '@relay/shared';
import type { LivePacket } from '@relay/shared';
import { Tabs } from '../../../frontend-shared/src/tabs';
import { PdfViewer } from './PdfViewer';

/** The packet being discussed: a version picker, its stage, and PDF / text tabs. Used by both call screens. */
export function PacketDocument({ id, packets, selected, onSelect, locked = false, showReview = false }: {
  id: string; packets: LivePacket[]; selected: LivePacket; onSelect: (packetId: string) => void; locked?: boolean; showReview?: boolean;
}): ReactNode {
  const [view, setView] = useState<'pdf' | 'summary'>('pdf');
  return <>
    <div className="relay-call-document-heading">
      {!locked && packets.length > 1 && <label className="relay-call-packet-picker">Packet version<select aria-label="Packet version" value={selected.id} onChange={event => onSelect(event.target.value)}>{packets.map(packet => <option value={packet.id} key={packet.id}>Planning packet · v{packet.version}</option>)}</select></label>}
      <PacketStatusBadge packet={selected}/>
    </div>
    {showReview && <PacketReviewNotice packet={selected}/>}
    <Tabs id={id} label="Document view" items={[{ id: 'pdf', label: 'PDF' }, { id: 'summary', label: 'Packet summary' }]} value={view} onChange={value => setView(value as 'pdf' | 'summary')}/>
    <div id={`${id}-${view}-panel`} role="tabpanel" aria-labelledby={`${id}-${view}-tab`}>
      {view === 'pdf' ? <PdfViewer packetId={selected.id}/> : <PacketSummary packet={selected}/>}
    </div>
  </>;
}
