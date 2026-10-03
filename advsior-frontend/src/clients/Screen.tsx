import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  advisorApi, advisorPacketHref, AssistantSidebar, Badge, Button, DocumentPreview, EmptyState, Icon,
  PacketReviewPanel, PacketStatusBadge, PacketSummary, ScreenState, packetStatus, useCaseDocuments, useCasePackets, useRelay,
} from '@relay/shared';
import type { AdvisorSession, LiveDocument, LivePacket } from '@relay/shared';
import './Screen.css';

type SharedItem =
  | { kind: 'packet'; id: string; date: string; packet: LivePacket }
  | { kind: 'source'; id: string; date: string; document: LiveDocument };

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

function ServerWorkspace({ params, update }: { params: URLSearchParams; update: (next: URLSearchParams) => void }) {
  const [session, setSession] = useState<AdvisorSession | null>(null);
  const [packetText, setPacketText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void advisorApi.session(controller.signal).then(value => {
      if (!controller.signal.aborted) setSession(value);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Advisor workspace unavailable.');
    });
    return () => controller.abort();
  }, []);
  const version = session?.workspace.versions.find(item => item.id === params.get('server_version'))
    ?? session?.workspace.versions.at(-1) ?? null;
  useEffect(() => {
    setPacketText(null);
    if (!session || !version) return;
    const controller = new AbortController();
    setError(null);
    void advisorApi.packetText(session.workspace.case_id, version, controller.signal).then(value => {
      if (!controller.signal.aborted) setPacketText(value);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Server packet preview unavailable.');
    });
    return () => controller.abort();
  }, [session, version]);
  return <section className="advisor-server-workspace" aria-label="Server shared packet preview">
    <nav className="advisor-client-breadcrumb" aria-label="Breadcrumb"><Link to="/advisor/home">Home</Link><span aria-hidden="true">›</span><strong>Server synthetic advisor workspace</strong></nav>
    <header className="advisor-client-heading">
      <h2>{session?.workspace.company ?? 'Server shared packet'}</h2>
      <p>Server synthetic advisor workspace · Read-only evidence</p>
      <Button variant="outline" onClick={() => updateParams(params, update, { advisor_demo: null, server_version: null, compare_version: null })}>Return to browser demo documents</Button>
    </header>
    {error && <p role="alert" className="advisor-server-error">{error}</p>}
    {session && version && <>
      <label className="advisor-server-version">Shared packet version
        <select aria-label="Visible server packet" value={version.id} onChange={event => updateParams(params, update, { server_version: event.currentTarget.value, compare_version: null })}>
          {session.workspace.versions.map(item => <option key={item.id} value={item.id}>{item.title} · v{item.version}</option>)}
        </select>
      </label>
      <article className="advisor-server-document" aria-label={`Server packet version ${version.version}`}>
        <h3>{version.title} · v{version.version}</h3>
        <p>Exact server hash: <code>{version.hash}</code></p>
        {packetText === null ? <p role="status">Loading authorized server packet…</p> : <pre>{packetText}</pre>}
        <a href={advisorPacketHref(session.workspace.case_id, version)} target="_blank" rel="noopener noreferrer">Open authorized packet text</a>
      </article>
      <p className="advisor-client-version-note">This server version is the AI chat context. The browser demo's review controls do not change this server packet.</p>
    </>}
  </section>;
}

export default function Screen() {
  const { snapshot, role } = useRelay();
  const [params, setParams] = useSearchParams();
  const { packets: livePackets } = useCasePackets();
  const { documents } = useCaseDocuments();
  const query = (params.get('q') ?? '').trim().toLowerCase();
  const packets = livePackets ?? [];
  const items: SharedItem[] = [
    ...packets.map(packet => ({ kind: 'packet' as const, id: packet.id, date: packet.created_at, packet })),
    ...(documents ?? []).map(document => ({ kind: 'source' as const, id: document.id, date: document.uploaded_at, document })),
  ];
  const hasWorkspace = items.length > 0;
  const clientMatches = Boolean(snapshot && (snapshot.company + ' ' + snapshot.founder.name).toLowerCase().includes(query));
  const requestedSource = params.get('source');
  const requestedVersion = params.get('version');
  const selected = items.find(item => item.id === requestedSource || item.id === requestedVersion)
    ?? (requestedSource || requestedVersion || params.get('open') === 'none' ? null : items[0] ?? null);
  const selectedId = selected?.id ?? null;
  const serverMode = params.get('advisor_demo') === 'server';
  const latest = packets[0] ?? null;
  const reviewState = latest ? packetStatus(latest).label : 'Shared documents';

  function toggle(item: SharedItem): void {
    updateParams(params, setParams, {
      source: item.id === selectedId ? null : item.kind === 'source' ? item.id : null,
      version: item.id === selectedId ? null : item.kind === 'packet' ? item.id : null,
      open: item.id === selectedId ? 'none' : null,
    });
  }

  return <ScreenState>
    {!snapshot || role !== 'advisor' ? null : <div className="advisor-clients">
      <aside className="advisor-client-rail" aria-label="Assigned clients">
        <h1>Clients</h1>
        <label className="advisor-client-search">
          <span className="sr-only">Search assigned clients</span>
          <Icon name="search" size={18}/>
          <input value={params.get('q') ?? ''} placeholder="Search clients..." onChange={event => updateParams(params, setParams, { q: event.currentTarget.value || null })}/>
        </label>
        {!hasWorkspace
          ? <p className="advisor-client-rail-empty">No shared client workspace yet. A founder's confirmed handoff appears here.</p>
          : clientMatches
            ? <div className="advisor-client-rail-list">
                <button className="advisor-client-choice" type="button" aria-current="true" onClick={() => updateParams(params, setParams, { q: null, source: null, version: latest?.id ?? null, open: null })}>
                  <span className="advisor-client-choice-icon"><Icon name="folder" size={25}/></span>
                  <span><strong>{snapshot.company}</strong><small>{snapshot.founder.name}</small></span>
                  <span aria-hidden="true">›</span>
                </button>
              </div>
            : <div className="advisor-client-rail-empty"><p>No matching assigned client.</p><Button variant="outline" onClick={() => updateParams(params, setParams, { q: null })}>Clear search</Button></div>}
        <p className="advisor-client-rail-note">Showing the one client available in this local demo.</p>
      </aside>
      <section className="advisor-client-workspace" aria-label="Shared client documents">
        {serverMode ? <ServerWorkspace params={params} update={setParams}/>
          : !hasWorkspace
          ? <EmptyState title="No shared client workspace"><p>Only files in a founder's confirmed handoff appear here.</p></EmptyState>
          : !clientMatches
            ? <EmptyState title="No matching assigned client"><p>Search checks the assigned client name.</p></EmptyState>
            : <>
              <nav className="advisor-client-breadcrumb" aria-label="Breadcrumb"><Link to="/advisor/home">Home</Link><span aria-hidden="true">›</span><strong>{snapshot.company}</strong></nav>
              <header className="advisor-client-heading">
                <h2>{snapshot.company}</h2>
                <p>{snapshot.founder.name}<span aria-hidden="true"> · </span>{reviewState}</p>
                <div className="advisor-client-heading-meta"><span><Icon name="file" size={20}/>{items.length} shared document{items.length === 1 ? '' : 's'}</span><Link to="/advisor/call"><Icon name="call" size={20}/> Call client</Link></div>
              </header>
              <div className="advisor-client-documents">
                {items.map(item => {
                  const expanded = selected?.id === item.id;
                  return <article className={'advisor-client-document ' + (expanded ? 'is-expanded' : '')} key={item.id}>
                    <button type="button" className="advisor-client-document-toggle" aria-expanded={expanded} aria-controls={'advisor-client-content-' + item.id} onClick={() => toggle(item)}>
                      <span className="advisor-document-chevron" aria-hidden="true">{expanded ? '⌄' : '›'}</span>
                      <Icon name="file" size={25}/>
                      <strong>{item.kind === 'packet' ? 'Planning packet · v' + item.packet.version : item.document.filename}</strong>
                      {item.kind === 'packet' ? <PacketStatusBadge packet={item.packet}/> : <Badge>Original</Badge>}
                      <time dateTime={item.date}>{new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</time>
                    </button>
                    {expanded && <div id={'advisor-client-content-' + item.id} className="advisor-client-document-content">
                      {item.kind === 'packet'
                        ? <>
                            <PacketSummary packet={item.packet}/>
                            {item.packet.id === latest?.id
                              ? <PacketReviewPanel packet={item.packet}/>
                              : <p className="advisor-document-history">This is an earlier version. Decisions apply to the latest version only.</p>}
                          </>
                        : <DocumentPreview document={item.document}/>}
                    </div>}
                  </article>;
                })}
              </div>
              <p className="advisor-client-version-note">Access to each packet is tied to its shared version. Questions and approval apply to the exact version under review.</p>
            </>}
      </section>
      <AssistantSidebar subtitle={`Private to you · ${snapshot.company}`}/>
    </div>}
  </ScreenState>;
}
