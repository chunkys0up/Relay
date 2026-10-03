import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  advisorApi, advisorPacketHref, AdvisorChat, Badge, Button, Conversation, EmptyState, Icon, PacketPreview,
  ReviewControls, ScreenState, SourcePreview, useRelay,
} from '@relay/shared';
import type { AdvisorSession, PacketVersion, Source } from '@relay/shared';
import './Screen.css';

type SharedItem =
  | { kind: 'packet'; id: string; date: string; packet: PacketVersion }
  | { kind: 'source'; id: string; date: string; source: Source };

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
  const query = (params.get('q') ?? '').trim().toLowerCase();
  const packets = useMemo(() => {
    if (!snapshot || role !== 'advisor') return [];
    const advisorId = snapshot.advisors[0]?.id;
    return snapshot.packets.filter(packet => snapshot.grants.some(grant =>
      grant.advisor_id === advisorId
      && grant.packet_version_id === packet.id
      && grant.packet_hash === packet.hash,
    )).sort((a, b) => b.version - a.version);
  }, [role, snapshot]);
  const sources = useMemo(() => {
    if (!snapshot || role !== 'advisor') return [];
    const shared = new Set(snapshot.grants.filter(grant => grant.advisor_id === snapshot.advisors[0]?.id).flatMap(grant => grant.source_ids));
    return snapshot.sources.filter(source => shared.has(source.id));
  }, [role, snapshot]);
  const items: SharedItem[] = [
    ...packets.map(packet => ({ kind: 'packet' as const, id: packet.id, date: packet.created_at, packet })),
    ...sources.map(source => ({ kind: 'source' as const, id: source.id, date: source.created_at, source })),
  ];
  const hasWorkspace = items.length > 0;
  const clientMatches = Boolean(snapshot && (snapshot.company + ' ' + snapshot.founder.name).toLowerCase().includes(query));
  const requestedSource = params.get('source');
  const requestedVersion = params.get('version');
  const selected = items.find(item => item.id === requestedSource || (item.kind === 'packet' && (item.id === requestedVersion || String(item.packet.version) === requestedVersion)))
    ?? (requestedSource || requestedVersion || params.get('open') === 'none' ? null : items[0] ?? null);
  const selectedId = selected?.id ?? null;
  const serverMode = params.get('advisor_demo') === 'server';
  const latest = packets[0] ?? null;
  const latestReview = latest ? snapshot?.reviews.filter(review => review.packet_version_id === latest.id).sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1) : null;
  const reviewState = latestReview?.decision === 'approved' || latest?.status === 'approved'
    ? 'Approved'
    : latestReview?.decision === 'questions_returned' || latest?.status === 'questions_returned'
      ? 'Questions returned'
      : latest ? 'Ready for advisor review' : 'Shared sources';

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
                      <strong>{item.kind === 'packet' ? item.packet.title + ' · v' + item.packet.version : item.source.name}</strong>
                      <Badge tone={item.kind === 'packet' && item.packet.status === 'approved' ? 'success' : 'neutral'}>{item.kind === 'packet' ? item.packet.status.replaceAll('_', ' ') : 'Original'}</Badge>
                      <time dateTime={item.date}>{new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</time>
                    </button>
                    {expanded && <div id={'advisor-client-content-' + item.id} className="advisor-client-document-content">
                      {item.kind === 'packet'
                        ? <>
                            <PacketPreview packet={item.packet} compact/>
                            {item.packet.id === snapshot.current_packet_version_id
                              ? <ReviewControls packet={item.packet}/>
                              : <p className="advisor-document-history">This is a historical version. Decisions apply to the current shared version only.</p>}
                          </>
                        : <SourcePreview source={item.source}/>}
                    </div>}
                  </article>;
                })}
              </div>
              <p className="advisor-client-version-note">Access to each packet is tied to its shared version. Questions and approval apply to the exact version under review.</p>
            </>}
      </section>
      <aside className="advisor-client-assistant" aria-label="Private client AI chat">
        <header className="advisor-client-assistant-head">
          <div className="advisor-ai-avatar"><Icon name="agent" size={30}/></div>
          <div><h2>Relay AI</h2><Badge>{serverMode ? 'Server synthetic context' : 'Select server context'}</Badge><p>Private to the server-assigned advisor</p></div>
        </header>
        <div className={`advisor-client-conversation ${serverMode ? 'server-chat-mode' : 'browser-chat-mode'}`}>
          <AdvisorChat selectedPacketId={selected?.kind === 'packet' ? selected.id : latest?.id ?? null}/>
          {!serverMode && <><p className="advisor-browser-chat-label">Browser demo conversation · simulated and saved only in this browser</p><Conversation privateOnly/></>}
        </div>
        <p className="advisor-client-chat-note">{serverMode ? 'Server advisor AI uses only its exact shared synthetic packet and sources.' : 'Open the server synthetic workspace above for grounded advisor AI.'}</p>
      </aside>
    </div>}
  </ScreenState>;
}
