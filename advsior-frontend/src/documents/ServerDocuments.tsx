import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { advisorApi, advisorPacketHref, advisorCitationHref, AdvisorChat, Button, EmptyState, Icon, PageTitle } from '@relay/shared';
import type { AdvisorDocuments, AdvisorSession } from '@relay/shared';
import ExtractedDocument, { advisorOriginalHref } from './ExtractedDocument';

export default function ServerDocuments() {
  const [params, setParams] = useSearchParams();
  const [session, setSession] = useState<AdvisorSession | null>(null);
  const [documents, setDocuments] = useState<AdvisorDocuments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSession(null);
    setDocuments(null);
    setError(null);
    void advisorApi.session().then(value => {
      if (!controller.signal.aborted) setSession(value);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Advisor workspace unavailable.');
    });
    return () => controller.abort();
  }, [attempt]);
  const requested = params.get('server_version');
  const version = session?.workspace.versions.find(item => item.id === requested)
    ?? (requested ? null : session?.workspace.versions.at(-1)) ?? null;
  useEffect(() => {
    setDocuments(null);
    if (!session || !version) return;
    const controller = new AbortController();
    setError(null);
    void advisorApi.documents(session.workspace.case_id, version, controller.signal).then(value => {
      if (value.case_id !== session.workspace.case_id || value.versions.length !== 1
        || value.versions[0].id !== version.id || value.versions[0].hash !== version.hash) {
        throw new Error('The document response does not match this shared version.');
      }
      if (!controller.signal.aborted) setDocuments(value);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Documents unavailable.');
    });
    return () => controller.abort();
  }, [session, version]);
  // Hide old evidence immediately when selection changes, before effects run.
  const current = documents?.versions[0];
  const ready = current?.id === version?.id && current?.hash === version?.hash && documents !== null;
  const sources = ready && version ? documents.sources.filter(item =>
    item.version_id === version.id && version.source_ids.includes(item.id)) : [];
  const sourceId = params.get('server_source');
  const source = sources.find(item => item.id === sourceId);
  const query = (params.get('q') ?? '').trim().toLowerCase();
  function select(changes: Record<string, string | null>): void {
    const next = new URLSearchParams(params);
    next.set('advisor_demo', 'server');
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    setParams(next);
  }
  const sourceHref = source && session && version ? advisorCitationHref({
    source_id: source.id, source_hash: source.hash, version_id: version.id, label: source.name,
    url: `/api/advisor/cases/${encodeURIComponent(session.workspace.case_id)}/sources/${encodeURIComponent(source.id)}/preview?${new URLSearchParams({ version_id: version.id, packet_hash: version.hash, source_hash: source.hash })}`,
  }, session.workspace.case_id, [version]) : null;
  const originalHref = ready && session && version
    ? advisorOriginalHref(source ? source.original_url : current?.original_url, session.workspace.case_id,
      version, source ? { id: source.id, hash: source.hash } : undefined)
    : null;
  return <div className="advisor-documents">
    <PageTitle title="Documents" subtitle="Connected advisor workspace · shared versions and source evidence"/>
    <div className="advisor-documents-grid">
      <aside className="advisor-documents-files" aria-label="Shared client files">
        <header className="advisor-documents-client"><div><strong>{session?.workspace.company ?? 'Advisor workspace'}</strong><small>Server synthetic workspace</small></div></header>
        <label>Search documents<input aria-label="Search documents" value={params.get('q') ?? ''} onChange={event => select({ q: event.currentTarget.value || null })}/></label>
        <div className="advisor-documents-file-group"><h2>Packet versions</h2>
          {session?.workspace.versions.filter(item => `${item.title} v${item.version}`.toLowerCase().includes(query)).map(item => <button type="button" key={item.id} className={'advisor-document-file ' + (version?.id === item.id && !sourceId ? 'is-selected' : '')} aria-pressed={version?.id === item.id && !sourceId} onClick={() => select({ server_version: item.id, server_source: null, compare_version: null })}><Icon name="file" size={20}/><span><strong>{item.title}</strong><small>Version {item.version}</small></span></button>)}
        </div>
        <div className="advisor-documents-file-group"><h2>Shared sources</h2>
          {sources.filter(item => item.name.toLowerCase().includes(query)).map(item => <button type="button" key={item.id} className={'advisor-document-file ' + (sourceId === item.id ? 'is-selected' : '')} aria-pressed={sourceId === item.id} onClick={() => select({ server_source: item.id })}><Icon name="file" size={20}/><span><strong>{item.name}</strong><small>Shared source text</small></span></button>)}
          {ready && !sources.some(item => item.name.toLowerCase().includes(query)) && <p>No shared sources match this search.</p>}
        </div>
        <Link className="advisor-documents-back" to={`/advisor/clients?${new URLSearchParams({ advisor_demo: 'server', ...(version ? { server_version: version.id } : {}) })}`}>← Back to clients</Link>
        <Link className="advisor-documents-back" to="/advisor/documents?advisor_demo=browser">Open browser demo reviews</Link>
      </aside>
      <section className="advisor-documents-center" aria-label="Document preview and review">
        {error ? <div role="alert"><p>{error}</p><Button onClick={() => setAttempt(value => value + 1)}>Retry documents</Button></div>
          : !session ? <p role="status">Loading advisor workspace…</p>
          : !version ? <EmptyState title={requested ? 'Shared version unavailable' : 'No shared documents'}><p>Select an authorized version from the document list.</p></EmptyState>
          : !ready ? <p role="status">Loading authorized documents…</p>
          : sourceId && !source ? <EmptyState title="Shared source unavailable"><p>This source is not included in the selected version.</p></EmptyState>
          : <>
            <div className="advisor-documents-preview-head"><div><h2>{source ? source.name : `${version.title} · v${version.version}`}</h2><p>{session.workspace.company} · Shared version {version.version}</p></div></div>
            <article className="advisor-connected-preview" aria-label={source ? 'Shared source preview' : `Server packet version ${version.version}`}>
              <ExtractedDocument text={source ? source.text : current?.text ?? ''}
                extraction={source ? source.extraction : current?.extraction}
                originalHref={(source ? source.extraction : current?.extraction) ? originalHref : null}/>
              <a href={sourceHref ?? advisorPacketHref(session.workspace.case_id, version)} target="_blank" rel="noopener noreferrer">Open authorized {source ? 'source' : 'packet'} text</a>
              {source && <Button variant="outline" onClick={() => select({ server_source: null })}>Return to packet v{version.version}</Button>}
            </article>
            <div className="advisor-documents-review"><h2>Review this version</h2><p>Use “Missing or conflicting evidence” or “Draft follow-up questions” in Relay AI to review this exact shared version with source citations.</p><p>Questions remain private drafts. Server approvals and delivery to the founder are not available.</p></div>
          </>}
      </section>
      <aside className="advisor-documents-conversation" aria-label="Private document AI review">
        <header className="advisor-documents-conversation-head"><h2>Relay AI</h2><p>Private review of the selected shared packet</p></header>
        <div className="advisor-documents-chat">{version && ready && !error ? <AdvisorChat selectedPacketId={version.id} serverActive/> : <p>Select an available shared packet to review its evidence.</p>}</div>
      </aside>
    </div>
  </div>;
}
