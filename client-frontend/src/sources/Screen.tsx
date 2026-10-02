import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, Conversation, EmptyState, Icon, PageTitle, Panel, ScreenState, SourcePreview, useRelay } from '@relay/shared';
import type { Source } from '@relay/shared';
import './styles.css';

function extractionLabel(source: Source): string {
  if (source.extraction === 'ready') return 'Ready';
  if (source.extraction === 'failed') return 'Needs attention';
  return source.extraction === 'queued' ? 'Queued' : 'Processing';
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function sourceSearchText(source: Source): string {
  return [source.name, source.excerpt, source.mime_type, ...source.citations.map((citation) => citation.label)].join(' ').toLowerCase();
}

export default function Screen() {
  const { snapshot } = useRelay();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const requestedSource = searchParams.get('source');
  const filteredSources = snapshot?.sources.filter((source) => !query.trim() || sourceSearchText(source).includes(query.trim().toLowerCase())) ?? [];
  const selectedSource = filteredSources.find((source) => source.id === requestedSource) ?? filteredSources[0] ?? null;
  const readyCount = snapshot?.sources.filter((source) => source.extraction === 'ready').length ?? 0;
  const processingCount = snapshot?.sources.filter((source) => source.extraction === 'processing' || source.extraction === 'queued').length ?? 0;

  const updateQuery = (value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  const chooseSource = (sourceId: string): void => {
    const next = new URLSearchParams(searchParams);
    next.set('source', sourceId);
    setSearchParams(next, { replace: true });
  };

  return (
    <ScreenState>
      {snapshot && (
        <div className="founder-sources">
          <PageTitle title="Sources" subtitle="View the original files and extraction details behind your packet.">
            <Link className="button button-outline" to="/founder/home">Add sources in Home chat <span aria-hidden="true">↗</span></Link>
          </PageTitle>
          <p className="founder-sources-guidance">These synthetic fixture originals demonstrate how files selected from the Home conversation will appear here. This view only browses existing originals.</p>

          <div className="founder-sources-workspace">
            <div className="founder-sources-primary">
          {snapshot.sources.length === 0 ? (
            <Panel><EmptyState title="No original sources yet"><p>Choose files from the attachment control in Home chat. The current local demo cannot upload or store them.</p><Link className="button button-primary" to="/founder/home">Go to Home chat</Link></EmptyState></Panel>
          ) : (
            <>
              <div className="founder-sources-summary" aria-label="Source totals">
                <div><strong>{snapshot.sources.length}</strong><span>original files</span></div>
                <div><strong>{readyCount}</strong><span>ready to review</span></div>
                <div><strong>{processingCount}</strong><span>processing</span></div>
              </div>

              <Panel className="founder-sources-list-panel">
                <div className="founder-sources-heading">
                  <div><h2>Workspace sources</h2><span>{snapshot.sources.length} originals · synthetic fixtures</span></div>
                  <label className="founder-sources-search"><span className="sr-only">Search original sources</span><Icon name="search" size={18}/><input type="search" value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Search sources" /></label>
                </div>
                {filteredSources.length === 0 ? (
                  <EmptyState title="No sources match this search"><p>Try another file name or phrase from an extracted excerpt.</p><Button variant="outline" onClick={() => updateQuery('')}>Clear search</Button></EmptyState>
                ) : (
                  <div className="founder-sources-table-wrap table-scroll">
                    <table className="founder-sources-table">
                      <thead><tr><th scope="col">Original file</th><th scope="col">Extraction</th><th scope="col">Source details</th></tr></thead>
                      <tbody>
                        {filteredSources.map((source) => (
                          <tr key={source.id} className={selectedSource?.id === source.id ? 'is-selected' : ''}>
                            <td><button className="founder-sources-file-button" type="button" aria-pressed={selectedSource?.id === source.id} onClick={() => chooseSource(source.id)}><Icon name="file" size={27}/><span><strong>{source.name}</strong><small>{source.citations.map((citation) => citation.locator.sheet ? `Sheet ${citation.locator.sheet}` : citation.locator.page ? `p. ${citation.locator.page}` : '').filter(Boolean).join(' · ') || source.mime_type.split('/').at(-1)} · {formatBytes(source.bytes)}</small></span></button></td>
                            <td><Badge tone={source.extraction === 'failed' ? 'attention' : source.extraction === 'ready' ? 'success' : 'neutral'}>{extractionLabel(source)}</Badge></td>
                            <td><span className="founder-sources-meta">Added {new Date(source.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              {selectedSource ? (
                <div className="founder-sources-preview-grid">
                  <div className="founder-sources-preview">
                    <div className="founder-sources-preview-title"><div><span className="eyebrow">Source preview</span><h2>{selectedSource.name}</h2><p>{selectedSource.mime_type} · {formatBytes(selectedSource.bytes)} · Original revision {selectedSource.revision}</p></div><Badge tone={selectedSource.extraction === 'ready' ? 'success' : selectedSource.extraction === 'failed' ? 'attention' : 'neutral'}>{extractionLabel(selectedSource)}</Badge></div>
                    <SourcePreview source={selectedSource}/>
                    <div className="founder-sources-metadata" aria-label="Source metadata">
                      <h3>Source metadata</h3>
                      <dl><div><dt>Added</dt><dd>{new Date(selectedSource.created_at).toLocaleString()}</dd></div><div><dt>Content type</dt><dd>{selectedSource.mime_type}</dd></div><div><dt>Content hash</dt><dd><code>{selectedSource.hash.slice(0, 12)}…</code></dd></div><div><dt>Extraction</dt><dd>{selectedSource.error ?? extractionLabel(selectedSource)}</dd></div></dl>
                      <p>Original-file download and full document preview are unavailable in this local simulation.</p>
                    </div>
                  </div>
                  <aside className="founder-sources-flags" aria-label="Packet context for this source">
                    <Panel title="Packet references">
                      {snapshot.flags.filter((flag) => flag.packet_version_id === snapshot.current_packet_version_id && !flag.resolved && flag.citations.some((citation) => citation.source_id === selectedSource.id)).length === 0 ? (
                        <p className="muted">No unresolved packet questions cite this source.</p>
                      ) : snapshot.flags.filter((flag) => flag.packet_version_id === snapshot.current_packet_version_id && !flag.resolved && flag.citations.some((citation) => citation.source_id === selectedSource.id)).map((flag) => (
                        <div className="founder-sources-flag" key={flag.id}><Badge tone="attention">{flag.kind === 'missing' ? 'Missing detail' : flag.kind === 'conflict' ? 'Source conflict' : 'Needs review'}</Badge><p>{flag.text}</p></div>
                      ))}
                      <Link className="founder-sources-home-link" to="/founder/home">Return to Home conversation <span aria-hidden="true">↗</span></Link>
                    </Panel>
                  </aside>
                </div>
              ) : (
                <Panel><EmptyState title="No source matches the current search"><p>The selected source is hidden by the current search query.</p></EmptyState></Panel>
              )}
            </>
          )}
            </div>
            <aside className="founder-sources-conversation" aria-label="Home conversation">
              <Conversation />
            </aside>
          </div>
        </div>
      )}
    </ScreenState>
  );
}
