import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Badge, Button, CitationLink, Conversation, EmptyState, Icon, PageTitle,
  PacketPreview, Panel, ScreenState, SourcePreview, useRelay,
} from '@relay/shared';
import './Screen.css';

function updateParams(
  search: URLSearchParams,
  setSearch: (next: URLSearchParams) => void,
  updates: Record<string, string | null>,
): void {
  const next = new URLSearchParams(search);
  for (const [key, value] of Object.entries(updates)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  setSearch(next);
}

export default function Screen() {
  const { snapshot, role, error, notice } = useRelay();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const available = useMemo(() => {
    if (!snapshot || role !== 'advisor') return [];
    return snapshot.packets.filter(packet =>
      snapshot.grants.some(grant =>
        grant.advisor_id === snapshot.advisors[0]?.id &&
        grant.packet_version_id === packet.id &&
        grant.packet_hash === packet.hash,
      ),
    );
  }, [role, snapshot]);
  const sources = snapshot?.sources ?? [];
  const latest = available.find(packet => packet.id === snapshot?.current_packet_version_id)
    ?? available.at(-1) ?? null;
  const match = snapshot && role === 'advisor'
    && `${snapshot.company} ${snapshot.founder.name}`.toLowerCase().includes(query.trim().toLowerCase());
  const requestedSource = params.get('source');
  const selectedSource = sources.find(source => source.id === requestedSource) ?? null;
  const requestedVersion = params.get('version');
  const selectedPacket = available.find(packet => packet.id === requestedVersion) ?? latest;
  const flags = selectedPacket
    ? snapshot?.flags.filter(flag => flag.packet_version_id === selectedPacket.id) ?? []
    : [];
  const rows = [
    ...(selectedPacket ? [{ id: selectedPacket.id, name: selectedPacket.title + ' · v' + selectedPacket.version, kind: 'packet' as const, date: selectedPacket.created_at }] : []),
    ...sources.map(source => ({ id: source.id, name: source.name, kind: 'source' as const, date: source.created_at })),
  ].sort((a, b) => {
    if (a.kind === 'packet' && b.kind !== 'packet') return -1;
    if (a.kind !== 'packet' && b.kind === 'packet') return 1;
    return b.date.localeCompare(a.date);
  });

  return <ScreenState>
    {!snapshot || role !== 'advisor' ? null : <div className="advisor-clients">
      <div className="advisor-clients-main">
        <PageTitle title="Clients" subtitle="Your assigned founder workspaces" />
        {error && <div className="feedback feedback-error" role="alert">{error}</div>}
        {notice && <div className="feedback" role="status">{notice}</div>}
        <div className="advisor-clients-toolbar">
          <label className="advisor-client-search"><span className="sr-only">Search assigned clients</span><Icon name="search" size={18}/><input value={query} placeholder="Search clients" onChange={event => updateParams(params, setParams, { q: event.currentTarget.value || null })}/></label>
          <span className="advisor-client-filter"><Badge>Assigned to you</Badge></span>
        </div>
        {!snapshot.packets.length && !sources.length
          ? <EmptyState title="No shared client workspace"><p>Only a founder’s confirmed handoff appears here.</p></EmptyState>
          : !match
            ? <EmptyState title="No matching assigned client"><p>Search checks the assigned founder workspace only.</p><Button variant="outline" onClick={() => updateParams(params, setParams, { q: null })}>Clear search</Button></EmptyState>
            : <>
              <button className="advisor-client-card" type="button" aria-pressed="true" onClick={() => updateParams(params, setParams, { source: null, version: latest?.id ?? null })}>
                <span className="advisor-folder-icon"><Icon name="folder" size={35}/></span>
                <strong>{snapshot.company}</strong>
                <span>Founder: {snapshot.founder.name}</span>
                <Badge tone={flags.length ? 'attention' : 'neutral'}>{flags.length ? `${flags.length} source details to review` : 'Shared for review'}</Badge>
                <small>Assigned to {snapshot.advisors[0]?.name ?? 'you'}</small>
              </button>
              <div className="advisor-client-divider"/>
              <nav className="advisor-client-breadcrumb" aria-label="Breadcrumb"><span>Clients</span><span aria-hidden="true">/</span><strong>{snapshot.company}</strong></nav>
              <div className="advisor-files-heading"><h2>Files</h2><span>{rows.length} shared items</span></div>
              {rows.length === 0
                ? <EmptyState title="No shared files"><p>The founder has not included material in the active handoff.</p></EmptyState>
                : <div className="advisor-file-list">
                  <div className="advisor-file-header"><span>Name</span><span>Access</span><span>Updated</span></div>
                  {rows.map(row => {
                    const selected = row.kind === 'source' ? row.id === requestedSource : row.id === requestedVersion || (!requestedSource && !requestedVersion && row.id === latest?.id);
                    return <button type="button" className={`advisor-file-row ${selected ? 'is-selected' : ''}`} key={row.id} aria-pressed={selected} onClick={() => updateParams(params, setParams, row.kind === 'source' ? { source: row.id, version: null } : { source: null, version: row.id })}>
                      <span className="advisor-file-name"><Icon name="file" size={22}/><span>{row.name}</span></span><Badge tone={row.kind === 'packet' ? 'attention' : 'neutral'}>{row.kind === 'packet' ? 'Packet version' : 'Shared source'}</Badge><time dateTime={row.date}>{new Date(row.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</time>
                    </button>;
                  })}
                </div>}
              <p className="advisor-file-footnote">{rows.length} items · Handoff access is version-bound</p>
              <div className="advisor-file-preview">
                {selectedSource
                  ? <SourcePreview source={selectedSource}/>
                  : selectedPacket
                    ? <Panel title="Packet preview"><PacketPreview packet={selectedPacket} compact/></Panel>
                    : <EmptyState title="Choose a shared file"><p>Select a shared original or packet version to preview it.</p></EmptyState>}
              </div>
            </>}
      </div>
      <aside className="advisor-client-assistant" aria-label="Client assistant">
        <div className="advisor-client-assistant-head"><Icon name="agent" size={38}/><div><strong>Review with Relay</strong><span>{snapshot.company} · {snapshot.advisors[0]?.name} / {snapshot.founder.name}</span></div></div>
        <div className="advisor-client-assistant-state"><Badge tone={snapshot.ui_state === 'Needs input' ? 'attention' : 'neutral'}>{snapshot.ui_state}</Badge><a href="/advisor/call">Open Call ↗</a></div>
        {flags.length > 0 && <Panel title="Source details to review" className="advisor-client-flags">{flags.map(flag=><div key={flag.id} className="advisor-client-flag"><strong>{flag.kind === 'missing' ? 'Missing detail' : 'Source conflict'}</strong><p>{flag.text}</p>{flag.citations.map(citation=><CitationLink key={citation.source_id+citation.label} citation={citation}/>)}</div>)}</Panel>}
        <div className="advisor-client-conversation"><Conversation/></div>
        <p className="advisor-client-call-note">Call is a separate destination. Capture requires each participant’s explicit consent.</p>
      </aside>
    </div>}
  </ScreenState>;
}
