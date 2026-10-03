import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Conversation, EmptyState, Icon, PageTitle, PacketPreview,
  ReviewControls, ScreenState, SourcePreview, useRelay,
} from '@relay/shared';
import './Screen.css';

function setParams(search: URLSearchParams, update: (next: URLSearchParams) => void, changes: Record<string, string | null>): void {
  const next = new URLSearchParams(search);
  for (const [key, value] of Object.entries(changes)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  update(next);
}

export default function Screen() {
  const { snapshot, role } = useRelay();
  const [params, update] = useSearchParams();
  const query = (params.get('q') ?? '').trim().toLowerCase();
  const packets = useMemo(() => {
    if (!snapshot || role !== 'advisor') return [];
    return snapshot.packets.filter(packet => snapshot.grants.some(grant =>
      grant.advisor_id === snapshot.advisors[0]?.id && grant.packet_version_id === packet.id && grant.packet_hash === packet.hash,
    )).sort((a,b) => a.version - b.version);
  }, [role, snapshot]);
  const requested = params.get('version');
  const packet = packets.find(item => item.id === requested || String(item.version) === requested)
    ?? packets.find(item => item.id === snapshot?.current_packet_version_id)
    ?? packets.at(-1) ?? null;
  const grant = packet && snapshot ? snapshot.grants.find(item => item.advisor_id === snapshot.advisors[0]?.id && item.packet_version_id === packet.id && item.packet_hash === packet.hash) : undefined;
  const sources = snapshot?.sources.filter(source => grant?.source_ids.includes(source.id)) ?? [];
  const visiblePackets = packets.filter(item => !query || (item.title + ' v' + item.version).toLowerCase().includes(query));
  const requestedSource = params.get('source');
  const source = sources.find(item => item.id === requestedSource)
    ?? (query ? sources.find(item => item.name.toLowerCase().includes(query)) : null)
    ?? null;
  const isCurrent = Boolean(packet && packet.id === snapshot?.current_packet_version_id);
  const statusLabel = (value: string): { label: string; tone: 'neutral' | 'attention' | 'success' } => {
    if (value === 'approved') return { label: 'Approved version', tone: 'success' };
    if (value === 'questions_returned') return { label: 'Questions returned', tone: 'attention' };
    if (value === 'in_review') return { label: 'Review required', tone: 'attention' };
    return { label: 'Draft shared', tone: 'neutral' };
  };

  return <ScreenState>
    {!snapshot || role !== 'advisor' ? null : <div className="advisor-documents">
      <PageTitle title="Documents" subtitle="Shared packet versions and originals" />
      <div className="advisor-documents-grid">
        <aside className="advisor-documents-files" aria-label="Shared client files">
          <header className="advisor-documents-client"><Icon name="folder" size={24}/><div><strong>{snapshot.company}</strong><small>{sources.length} shared original{sources.length===1?'':'s'}</small></div></header>
          <div className="advisor-documents-file-group"><h2>Packet versions</h2>
            {visiblePackets.length ? visiblePackets.slice().reverse().map(item=>{
              const selected=packet?.id===item.id && !requestedSource;
              const status=statusLabel(item.status);
              return <button type="button" className={'advisor-document-file ' + (selected?'is-selected':'')} key={item.id} aria-pressed={selected} onClick={()=>setParams(params,update,{version:item.id,source:null})}><Icon name="file" size={20}/><span><strong>{item.title}</strong><small>Version {item.version}</small></span><Badge tone={status.tone}>{status.label}</Badge></button>;
            }) : <p className="advisor-document-empty-note">No packet versions match this search.</p>}
          </div>
          <div className="advisor-documents-file-group"><h2>Shared originals</h2>
            {sources.filter(item => !query || item.name.toLowerCase().includes(query)).map(item =>
              <button type="button" className="advisor-document-file advisor-source-file" key={item.id} onClick={() => setParams(params, update, { version: packet?.id ?? null, source: item.id })}>
                <Icon name="file" size={20}/><span><strong>{item.name}</strong><small>Original · shared by founder</small></span><Badge>Source {item.extraction === 'ready' ? 'ready' : item.extraction}</Badge>
              </button>)}
            {query && !sources.some(item => item.name.toLowerCase().includes(query)) &&
              <p className="advisor-document-empty-note">No shared originals match this search.</p>}
            {!query && sources.length === 0 && <p className="advisor-document-empty-note">No originals are included in this selected packet grant.</p>}
          </div>
          <Link className="advisor-documents-back" to="/advisor/clients">← Back to clients</Link>
        </aside>

        <section className="advisor-documents-center" aria-label="Document preview and review">
          <div className="advisor-documents-preview-head">
            {source ? <div><h2>{source.name}</h2><p>Shared original · {snapshot.company}</p></div> : packet ? <div><h2>{packet.title} · v{packet.version}</h2><p>{snapshot.company} · Prepared for {snapshot.founder.name}</p></div> : <div><h2>Document preview</h2><p>Select a shared item</p></div>}
            {packet && <label className="advisor-version-select">Packet version<select aria-label="Packet version" value={packet.id} onChange={event=>setParams(params,update,{version:event.currentTarget.value,source:null})}>{packets.slice().reverse().map(item=><option key={item.id} value={item.id}>v{item.version} · {statusLabel(item.status).label}</option>)}</select></label>}
          </div>
          {source ? <SourcePreview source={source}/> : packet ? <PacketPreview packet={packet}/> : <EmptyState title="No shared document"><p>This advisor can see only material included in an explicit handoff.</p></EmptyState>}
          {packet && <div className="advisor-documents-review">
            <div className="advisor-documents-review-heading"><div><h2>Review this version</h2><p>Decisions apply to this exact packet and hash.</p></div><Badge tone={statusLabel(packet.status).tone}>{statusLabel(packet.status).label}</Badge></div>
            {source ? <div className="advisor-documents-locked"><p>Source preview only. Any decision remains bound to packet v{packet.version}.</p><Button variant="outline" onClick={()=>setParams(params,update,{source:null,version:packet.id})}>Return to packet v{packet.version}</Button></div> : isCurrent ? <ReviewControls packet={packet}/> : <div className="advisor-documents-locked" role="status">This shared version is historical. It remains readable; review actions require the current shared version.</div>}
          </div>}
        </section>

        <aside className="advisor-documents-conversation" aria-label="Packet conversation">
          <header className="advisor-documents-conversation-head"><div><h2>Conversation</h2><p>{snapshot.advisors[0]?.name} · Advisor &nbsp; {snapshot.founder.name} · Founder</p></div><Link className="button button-outline" to="/advisor/call">Open Call ↗</Link></header>
          {packet && <div className="advisor-documents-conversation-context"><Icon name="file" size={18}/><span>{packet.title} · v{packet.version}</span></div>}
          <div className="advisor-documents-chat"><Conversation/></div>
          <p className="advisor-documents-chat-note">AI activity is simulated. A human recipient is always named before sending.</p>
        </aside>
      </div>
    </div>}
  </ScreenState>;
}
