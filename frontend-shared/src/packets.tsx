import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRelay } from './context';
import { useCaseReload } from './live';
import { MarkdownText } from './markdown';
import { announceCaseUpdate, documentUrl, LIVE_CASE_ID, listPackets, packetSummary, packetUrl, reviewPacket } from './relayApi';
import type { LiveDocument, LivePacket, PacketStatus, ReviewDecision } from './relayApi';
import { Badge, Button, Icon } from './ui';
import './packets.css';

const errorText = (error: unknown, fallback: string): string => error instanceof Error ? error.message : fallback;

const statusLabels: Record<PacketStatus, { label: string; tone: 'neutral' | 'attention' | 'success' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  in_review: { label: 'In review', tone: 'attention' },
  approved: { label: 'Approved', tone: 'success' },
  questions_returned: { label: 'Questions returned', tone: 'attention' },
};

export function packetStatus(packet: LivePacket): { label: string; tone: 'neutral' | 'attention' | 'success' } {
  return statusLabels[packet.status] ?? { label: packet.status, tone: 'neutral' };
}

export function PacketStatusBadge({ packet }: { packet: LivePacket }): ReactNode {
  const { label, tone } = packetStatus(packet);
  return <Badge tone={tone}>{label}</Badge>;
}

/** The case's packet versions, newest first; refetches whenever the case changes. */
export function useCasePackets(caseId: string = LIVE_CASE_ID): { packets: LivePacket[] | null; error: string | null } {
  const [packets, setPackets] = useState<LivePacket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCaseReload();
  useEffect(() => {
    const c = new AbortController();
    listPackets(caseId, c.signal).then(next => { setPackets(next); setError(null); })
      .catch((e: unknown) => { if (!c.signal.aborted) setError(errorText(e, 'Packets could not be loaded.')); });
    return () => c.abort();
  }, [caseId, reload]);
  return { packets, error };
}

/** Relay's summary of the packet, written from the stored PDF's own text. */
export function PacketSummary({ packet }: { packet: LivePacket }): ReactNode {
  const [summary, setSummary] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const c = new AbortController();
    setError(null);
    packetSummary(packet.case_id, packet.id, c.signal).then(text => setSummary({ id: packet.id, text }))
      .catch((e: unknown) => { if (!c.signal.aborted) setError(errorText(e, 'The summary could not be loaded.')); });
    return () => c.abort();
  }, [packet.case_id, packet.id]);
  const shown = summary?.id === packet.id ? summary.text : null;
  async function openPdf(): Promise<void> {
    const tab = window.open('', '_blank');
    try { const url = await packetUrl(packet.case_id, packet.id); if (tab) tab.location.href = url; else window.open(url, '_blank'); }
    catch (e) { tab?.close(); setError(errorText(e, 'The PDF could not be opened.')); }
  }
  return <section className="packet-summary" aria-label={`Summary of packet v${packet.version}`}>
    <div className="packet-summary-head"><Icon name="file"/><strong>Planning packet · v{packet.version}</strong><PacketStatusBadge packet={packet}/><Button variant="outline" onClick={() => { void openPdf(); }}>Open PDF</Button></div>
    <div className="packet-summary-body">
      {error ? <p className="packet-summary-note" role="alert">{error}</p>
        : !shown ? <p className="packet-summary-note" role="status">Relay is summarizing the packet…</p>
        : <article className="packet-summary-page"><MarkdownText text={shown}/><small>Summarized by Relay from packet v{packet.version}. The PDF has the full document.</small></article>}
    </div>
  </section>;
}

/** The founder's view of the advisor's latest decision on a packet. */
export function PacketReviewNotice({ packet }: { packet: LivePacket }): ReactNode {
  const { snapshot } = useRelay();
  if (!packet.review_decision) return null;
  const advisor = snapshot?.advisors[0]?.name ?? 'Your advisor';
  return <div className={`packet-review-notice ${packet.review_decision === 'approved' ? 'is-approved' : 'is-returned'}`} role="status">
    <strong>{packet.review_decision === 'approved' ? `${advisor} approved packet v${packet.version}` : `${advisor} returned questions on packet v${packet.version}`}</strong>
    {packet.review_notes && <p>{packet.review_notes}</p>}
  </div>;
}

/** Advisor decision on one exact packet version: approve it, or return it with questions. Saved to the backend. */
export function PacketReviewPanel({ packet }: { packet: LivePacket }): ReactNode {
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState<ReviewDecision | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decided = packet.review_decision !== null;

  async function submit(decision: ReviewDecision): Promise<void> {
    setSaving(true); setError(null);
    try {
      await reviewPacket(packet.case_id, packet.id, decision, notes);
      setNotes(''); setConfirming(null);
      announceCaseUpdate();
    } catch (e) {
      setError(errorText(e, 'The review could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  return <section className="packet-review" aria-label={`Review packet v${packet.version}`}>
    <div className="packet-review-head"><h3>Review packet v{packet.version}</h3><PacketStatusBadge packet={packet}/></div>
    {decided && <p className="packet-review-last">
      Last decision: <strong>{packet.review_decision === 'approved' ? 'Approved' : 'Questions returned'}</strong>
      {packet.reviewed_at && <> · {new Date(packet.reviewed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}
      {packet.review_notes && <><br/>“{packet.review_notes}”</>}
    </p>}
    <label className="packet-review-notes">Questions or notes for the founder
      <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="For example: which 2026 revenue figure is final?" disabled={saving}/>
    </label>
    {error && <p className="feedback feedback-error" role="alert">{error}</p>}
    {confirming ? <div className="confirm-panel">
      <p>{confirming === 'approved' ? `Approve packet v${packet.version}? This covers this exact version only.` : `Return packet v${packet.version} to the founder with your questions?`}</p>
      <div className="packet-review-actions">
        <Button disabled={saving} onClick={() => { void submit(confirming); }}>{saving ? 'Saving…' : confirming === 'approved' ? 'Confirm approval' : 'Send questions'}</Button>
        <Button variant="outline" disabled={saving} onClick={() => setConfirming(null)}>Cancel</Button>
      </div>
    </div> : <div className="packet-review-actions">
      <Button onClick={() => setConfirming('approved')}>Approve v{packet.version}</Button>
      <Button variant="outline" disabled={!notes.trim()} onClick={() => setConfirming('questions_returned')}>Return with questions</Button>
    </div>}
  </section>;
}

/** Inline preview of an uploaded file: PDFs and images render in place; other files open in a new tab. */
export function DocumentPreview({ document: doc }: { document: LiveDocument }): ReactNode {
  const [url, setUrl] = useState<{ id: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = /\.pdf$/i.test(doc.filename) ? 'pdf' : /\.(png|jpe?g|gif|webp)$/i.test(doc.filename) ? 'image' : 'other';
  useEffect(() => {
    if (kind === 'other') return;
    const c = new AbortController();
    documentUrl(doc.id, c.signal).then(next => setUrl({ id: doc.id, url: next }))
      .catch((e: unknown) => { if (!c.signal.aborted) setError(errorText(e, 'The file could not be loaded.')); });
    return () => c.abort();
  }, [doc.id, kind]);
  async function openFile(): Promise<void> {
    const tab = window.open('', '_blank');
    try { const next = await documentUrl(doc.id); if (tab) tab.location.href = next; else window.open(next, '_blank'); }
    catch (e) { tab?.close(); setError(errorText(e, 'The file could not be opened.')); }
  }
  const shown = url?.id === doc.id ? url.url : null;
  return <section className="document-preview" aria-label={`Preview of ${doc.filename}`}>
    {error ? <p className="packet-summary-note" role="alert">{error}</p>
      : kind === 'other' ? <p className="packet-summary-note">This file type can&apos;t be previewed here.</p>
      : !shown ? <p className="packet-summary-note" role="status">Loading preview…</p>
      : kind === 'pdf' ? <iframe title={doc.filename} src={shown}/> : <img src={shown} alt={doc.filename}/>}
    <Button variant="outline" onClick={() => { void openFile(); }}>Open in new tab</Button>
  </section>;
}
