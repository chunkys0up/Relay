import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, CitationLink, Conversation, EmptyState, HandoffControls, Icon, PageTitle, PacketPreview, Panel, ScreenState, useRelay } from '@relay/shared';
import type { PacketVersion } from '@relay/shared';
import './styles.css';

function packetStatus(packet: PacketVersion): string {
  switch (packet.status) {
    case 'in_review': return 'Advisor review';
    case 'questions_returned': return 'Questions returned';
    case 'approved': return 'Advisor approved';
    default: return 'Draft';
  }
}

function packetTone(packet: PacketVersion): 'neutral' | 'attention' | 'success' {
  return packet.status === 'approved' ? 'success' : packet.status === 'questions_returned' ? 'attention' : 'neutral';
}

export default function Screen() {
  const { snapshot } = useRelay();
  const [searchParams, setSearchParams] = useSearchParams();
  const [compareMode, setCompareMode] = useState(false);
  const [compareId, setCompareId] = useState('');
  const query = searchParams.get('q')?.trim().toLowerCase() ?? '';
  const requestedVersion = searchParams.get('version');
  const versions = useMemo(() => [...(snapshot?.packets ?? [])].sort((a, b) => a.version - b.version), [snapshot?.packets]);
  const matches = versions.filter((packet) => !query || `${packet.title} ${packet.content} ${packet.status}`.toLowerCase().includes(query));
  const currentPacket = versions.find((packet) => packet.id === snapshot?.current_packet_version_id) ?? versions.at(-1) ?? null;
  const selectedPacket = matches.find((packet) => packet.id === requestedVersion) ?? (query ? matches.find((packet) => packet.id === currentPacket?.id) ?? matches.at(-1) ?? null : currentPacket);
  const currentFlags = snapshot?.flags.filter((flag) => flag.packet_version_id === selectedPacket?.id && !flag.resolved) ?? [];
  const sentQuestion = snapshot?.clarifications.find((question) => question.packet_version_id === selectedPacket?.id && question.status === 'sent');
  const selectedIndex = selectedPacket ? versions.findIndex((packet) => packet.id === selectedPacket.id) : -1;
  const comparePacket = compareMode && selectedIndex > 0 ? versions.find((packet) => packet.id === (compareId || versions[selectedIndex - 1]?.id)) ?? versions[selectedIndex - 1] : null;
  const isCurrent = Boolean(selectedPacket && currentPacket && selectedPacket.id === currentPacket.id && selectedPacket.hash === currentPacket.hash);

  const selectVersion = (packet: PacketVersion): void => {
    const next = new URLSearchParams(searchParams);
    next.set('version', packet.id);
    setSearchParams(next, { replace: true });
    setCompareMode(false);
  };

  const changedLines = comparePacket && selectedPacket
    ? selectedPacket.content.split('\n').filter((line) => line.trim() && !comparePacket.content.split('\n').includes(line))
    : [];

  return (
    <ScreenState>
      {snapshot && (
        <div className="founder-documents">
          <PageTitle title="Documents" subtitle="Your drafts and advisor-reviewed versions, prepared from your sources.">
            <Link className="button button-outline" to="/founder/sources">View sources <span aria-hidden="true">↗</span></Link>
          </PageTitle>

          {versions.length === 0 ? (
            <Panel><EmptyState title="No packet drafts yet"><p>Your generated drafts will appear here after the source review step. Original files stay in Sources.</p><Link className="button button-primary" to="/founder/sources">Browse sources</Link></EmptyState></Panel>
          ) : matches.length === 0 || !selectedPacket ? (
            <Panel><EmptyState title="No documents match this search"><p>Search by packet title, status, or text in the draft.</p><Link className="button button-outline" to="/founder/documents">Clear search</Link></EmptyState></Panel>
          ) : (
            <>
              <section className="founder-documents-file-list" aria-labelledby="founder-documents-list-title">
                <div className="founder-documents-list-heading"><h2 id="founder-documents-list-title">Packet versions</h2><span>{versions.length} version{versions.length === 1 ? '' : 's'} · synthetic drafts</span></div>
                <div className="founder-documents-version-rows">
                  {[...matches].reverse().map((packet) => (
                    <button key={packet.id} type="button" className={`founder-documents-version-row ${selectedPacket.id === packet.id ? 'is-selected' : ''}`} aria-pressed={selectedPacket.id === packet.id} onClick={() => selectVersion(packet)}>
                      <Icon name="file" size={21}/>
                      <span className="founder-documents-row-copy"><strong>{packet.title} · v{packet.version}</strong><small>{snapshot.company} · {new Date(packet.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</small></span>
                      <Badge tone={packetTone(packet)}>{packetStatus(packet)}</Badge>
                    </button>
                  ))}
                </div>
              </section>

              <div className="founder-documents-workspace">
                <section className="founder-documents-preview-column" aria-label="Packet preview and history">
                  <Panel className="founder-documents-preview-panel">
                    <div className="founder-documents-preview-heading">
                      <div><h2>{selectedPacket.title}</h2><Badge>{`v${selectedPacket.version}`}</Badge></div>
                      <div className="founder-documents-toolbar">
                        <Badge tone={packetTone(selectedPacket)}>{packetStatus(selectedPacket)}</Badge>
                        <button type="button" className="button button-outline" disabled={selectedIndex <= 0} aria-pressed={compareMode} onClick={() => { setCompareMode((value) => !value); setCompareId(versions[selectedIndex - 1]?.id ?? ''); }}>{compareMode ? 'Close comparison' : 'Compare versions'}</button>
                      </div>
                    </div>

                    <div className="founder-documents-preview-tabs" aria-label="Packet view">
                      <span aria-current="page">Preview</span><span>Version history</span>
                    </div>

                    <div className="founder-documents-preview-layout">
                      <nav className="founder-documents-history" aria-label="Version history">
                        <h3>Versions</h3>
                        {[...versions].reverse().map((packet) => (
                          <button key={packet.id} type="button" aria-current={packet.id === selectedPacket.id ? 'page' : undefined} className={packet.id === selectedPacket.id ? 'is-current' : ''} onClick={() => selectVersion(packet)}>
                            <strong>v{packet.version}</strong><span>{packetStatus(packet)}</span>
                          </button>
                        ))}
                      </nav>

                      <div className="founder-documents-paper-area">
                        {compareMode && comparePacket && (
                          <section className="founder-documents-comparison" aria-label="Version comparison">
                            <div className="founder-documents-compare-heading"><h3>Compare v{comparePacket.version} with v{selectedPacket.version}</h3><label>Earlier version<select value={comparePacket.id} onChange={(event) => setCompareId(event.target.value)}>{versions.slice(0, selectedIndex).map((packet) => <option key={packet.id} value={packet.id}>v{packet.version} · {packetStatus(packet)}</option>)}</select></label></div>
                            <p className="muted">{selectedPacket.changes.length ? selectedPacket.changes.join(' ') : 'No recorded change note for this version.'}</p>
                            {changedLines.length > 0 ? <ul>{changedLines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ul> : <p>No new text lines in this comparison.</p>}
                          </section>
                        )}
                        <PacketPreview packet={selectedPacket}/>
                      </div>
                    </div>

                    <section className="founder-documents-citations" aria-labelledby="founder-documents-citations-title">
                      <h3 id="founder-documents-citations-title">Sources cited in this version</h3>
                      {selectedPacket.citations.length ? selectedPacket.citations.map((citation, index) => <CitationLink key={`${citation.source_id}-${citation.label}-${index}`} citation={citation}/>) : <p className="muted">No source citations are attached to this draft.</p>}
                    </section>
                  </Panel>
                </section>

                <aside className="founder-documents-aside" aria-label="Version status and actions">
                  <Panel title="Review status">
                    <div className="founder-documents-status-row"><Badge tone={packetTone(selectedPacket)}>{packetStatus(selectedPacket)}</Badge><span>Case: {snapshot.status}</span></div>
                    {isCurrent ? <p>This is the current packet version. A previous approval never carries forward to a new version.</p> : <p>This is a historical version. Actions are disabled until you select the current packet.</p>}
                    {snapshot.reviews.filter((review) => review.packet_version_id === selectedPacket.id).map((review) => <div className="founder-documents-review" key={review.id}><strong>{review.reviewer.name}</strong><span>{review.decision === 'approved' ? 'Approved this exact version' : 'Returned questions for this version'}</span></div>)}
                    <Link className="founder-documents-call-link" to="/founder/call">Open Call <span aria-hidden="true">↗</span></Link>
                  </Panel>

                  {currentFlags.length > 0 && (
                    <Panel title="Details to resolve" className="founder-documents-flags">
                      {currentFlags.map((flag) => (
                        <div className="founder-documents-flag" key={flag.id}>
                          <Badge tone="attention">{flag.kind === 'missing' ? 'Missing detail' : flag.kind === 'conflict' ? 'Source conflict' : 'Uncertain'}</Badge>
                          <p>{flag.text}</p>
                          {flag.citations.map((citation, index) => <CitationLink key={`${citation.source_id}-${index}`} citation={citation}/>)}
                        </div>
                      ))}
                      <Link className="button button-outline" to={sentQuestion ? '/founder/home/clarification' : '/founder/home#message-main'}>{sentQuestion ? 'Answer clarification in chat' : 'Discuss in Home chat'}</Link>
                    </Panel>
                  )}

                  {isCurrent && <HandoffControls packet={selectedPacket}/>}
                  <Conversation />
                </aside>
              </div>
            </>
          )}
        </div>
      )}
    </ScreenState>
  );
}
