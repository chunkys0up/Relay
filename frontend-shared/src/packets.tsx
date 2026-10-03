import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRelay } from './context';
import { useCaseReload } from './live';
import { MarkdownText } from './markdown';
import { toast } from './toast';
import { announceCaseUpdate, documentText, documentUrl, editPacketSummary, isTextFile, LIVE_CASE_ID, listPackets, packetChanges, packetSummary, packetUrl, resolvePacketReview, reviewPacket, revertPacketSummary, saveDocumentText, uploadDocumentVersion, uploadPacketVersion } from './relayApi';
import type { LiveDocument, LivePacket, PacketChanges, PacketStatus, PacketSummaryView, ReviewDecision } from './relayApi';
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

/** What changed since the previous version: who made it, their note, and Relay's comparison of the two PDFs. */
function PacketChangesPanel({ packet }: { packet: LivePacket }): ReactNode {
  const [data, setData] = useState<{ id: string; value: PacketChanges } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (packet.version < 2) return;
    const c = new AbortController();
    setError(null);
    packetChanges(packet.case_id, packet.id, c.signal).then(value => setData({ id: packet.id, value }))
      .catch((e: unknown) => { if (!c.signal.aborted) setError(errorText(e, 'Relay couldn\'t compare the versions.')); });
    return () => c.abort();
  }, [packet.case_id, packet.id, packet.version]);
  if (packet.version < 2) return null;
  const shown = data?.id === packet.id ? data.value : null;
  return <section className="packet-changes" aria-label={`What changed in packet v${packet.version}`}>
    <div className="packet-changes-head"><strong>What changed since v{packet.version - 1}</strong>{packet.created_by && <small>by {packet.created_by}</small>}</div>
    {packet.change_note && <p className="packet-changes-note">“{packet.change_note}”</p>}
    {error ? <p className="packet-summary-note" role="alert">{error}</p>
      : !shown ? <p className="packet-changes-loading" role="status">Relay is comparing the versions…</p>
      : shown.changes && <MarkdownText text={shown.changes}/>}
  </section>;
}

/**
 * The packet's summary: Relay's, written from the stored PDF's own text, or the advisor's edited version.
 * Advisors can edit it, and revert to Relay's version.
 */
export function PacketSummary({ packet }: { packet: LivePacket }): ReactNode {
  const { snapshot, role } = useRelay();
  const [view, setView] = useState<{ id: string; data: PacketSummaryView } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canEdit = role === 'advisor';
  useEffect(() => {
    const c = new AbortController();
    setError(null);
    setDraft(null);
    packetSummary(packet.case_id, packet.id, c.signal).then(data => setView({ id: packet.id, data }))
      .catch((e: unknown) => { if (!c.signal.aborted) setError(errorText(e, 'The summary could not be loaded.')); });
    return () => c.abort();
  }, [packet.case_id, packet.id]);
  const shown = view?.id === packet.id ? view.data : null;

  async function openPdf(): Promise<void> {
    const tab = window.open('', '_blank');
    try { const url = await packetUrl(packet.case_id, packet.id); if (tab) tab.location.href = url; else window.open(url, '_blank'); }
    catch (e) { tab?.close(); setError(errorText(e, 'The PDF could not be opened.')); }
  }

  async function save(change: () => Promise<PacketSummaryView>): Promise<void> {
    setSaving(true); setError(null);
    try {
      const next = await change();
      setView({ id: packet.id, data: next });
      setDraft(null);
      announceCaseUpdate();
      toast(next.edited_by ? 'Summary saved' : 'Restored Relay\'s summary');
    } catch (e) {
      setError(errorText(e, 'The summary could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  async function uploadPacket(file: File): Promise<void> {
    setSaving(true); setError(null);
    try { const created = await uploadPacketVersion(packet.case_id, file, 'advisor'); announceCaseUpdate(); toast(`Uploaded packet v${created.version}`); }
    catch (e) { setError(errorText(e, 'The new version could not be uploaded.')); }
    finally { setSaving(false); }
  }

  const editor = snapshot?.advisors[0]?.name ?? 'Advisor';
  return <section className="packet-summary" aria-label={`Summary of packet v${packet.version}`}>
    <div className="packet-summary-head">
      <Icon name="file"/><strong>Planning packet · v{packet.version}</strong><PacketStatusBadge packet={packet}/>
      {canEdit && shown && draft === null && <Button variant="outline" onClick={() => setDraft(shown.summary)}>Edit summary</Button>}
      {canEdit && draft === null && <UploadButton label={saving ? 'Uploading…' : 'Upload new version'} accept="application/pdf,.pdf" disabled={saving} onPick={file => { void uploadPacket(file); }}/>}
      <Button variant="outline" onClick={() => { void openPdf(); }}>Open PDF</Button>
    </div>
    <div className="packet-summary-body">
      {error && <p className="packet-summary-note" role="alert">{error}</p>}
      {!shown ? !error && <p className="packet-summary-note" role="status">Relay is summarizing the packet…</p>
        : draft !== null ? <div className="packet-summary-page packet-summary-editor">
            <label htmlFor={`summary-${packet.id}`}>Edit the summary <small>Markdown: **bold**, - bullet points</small></label>
            <textarea id={`summary-${packet.id}`} value={draft} onChange={e => setDraft(e.target.value)} rows={16} disabled={saving}/>
            <div className="packet-review-actions">
              <Button disabled={saving || !draft.trim() || draft.trim() === shown.summary.trim()} onClick={() => { void save(() => editPacketSummary(packet.case_id, packet.id, draft, editor)); }}>{saving ? 'Saving…' : 'Save summary'}</Button>
              <Button variant="outline" disabled={saving} onClick={() => setDraft(null)}>Cancel</Button>
            </div>
          </div>
        : <article className="packet-summary-page">
            <PacketChangesPanel packet={packet}/>
            <MarkdownText text={shown.summary}/>
            <small>
              {shown.edited_by
                ? <>Edited by {shown.edited_by}{shown.edited_at && <> · {new Date(shown.edited_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}</>
                : <>Summarized by Relay from packet v{packet.version}. The PDF has the full document.</>}
              {canEdit && shown.edited_by && <button type="button" className="packet-summary-revert" disabled={saving} onClick={() => { void save(() => revertPacketSummary(packet.case_id, packet.id)); }}>Revert to Relay&apos;s version</button>}
            </small>
          </article>}
    </div>
  </section>;
}

const HIDDEN_EVENT = 'relay:review-hidden';
const hiddenKey = (packet: LivePacket): string => `relay-hidden-review:${packet.id}:${packet.reviewed_at ?? ''}`;

function isHidden(packet: LivePacket): boolean {
  try { return localStorage.getItem(hiddenKey(packet)) === '1'; } catch { return false; }
}

/**
 * Whether the advisor's latest decision on a packet should still be shown to the founder, with actions to
 * resolve it (saved for everyone) or hide it (this browser only). A new review from the advisor shows again.
 */
export function useReviewNotice(packet: LivePacket | undefined): { visible: boolean; resolve: () => Promise<void>; hide: () => void; busy: boolean; error: string | null } {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const rerender = (): void => setTick(tick => tick + 1);
    window.addEventListener(HIDDEN_EVENT, rerender);
    return () => window.removeEventListener(HIDDEN_EVENT, rerender);
  }, []);
  const visible = Boolean(packet?.review_decision && !packet.review_resolved_at && !isHidden(packet));
  return {
    visible, busy, error,
    hide: () => {
      if (!packet) return;
      try { localStorage.setItem(hiddenKey(packet), '1'); } catch { /* hidden until the page reloads */ }
      window.dispatchEvent(new Event(HIDDEN_EVENT));
      toast('Hidden on this device');
    },
    resolve: async () => {
      if (!packet) return;
      setBusy(true); setError(null);
      try { await resolvePacketReview(packet.case_id, packet.id); announceCaseUpdate(); toast('Marked resolved'); }
      catch (e) { setError(errorText(e, 'Could not mark this as resolved.')); }
      finally { setBusy(false); }
    },
  };
}

/** The founder's view of the advisor's latest decision on a packet, until it's resolved or hidden. */
export function PacketReviewNotice({ packet }: { packet: LivePacket }): ReactNode {
  const { snapshot, role } = useRelay();
  const notice = useReviewNotice(packet);
  if (role !== 'founder' || !notice.visible) return null;
  const advisor = snapshot?.advisors[0]?.name ?? 'Your advisor';
  const approved = packet.review_decision === 'approved';
  return <div className={`packet-review-notice ${approved ? 'is-approved' : 'is-returned'}`} role="status">
    <div className="packet-review-notice-text">
      <strong>{approved ? `${advisor} approved packet v${packet.version}` : `${advisor} returned questions on packet v${packet.version}`}</strong>
      {packet.review_notes && <p>{packet.review_notes}</p>}
      {notice.error && <p role="alert">{notice.error}</p>}
    </div>
    <div className="packet-review-notice-actions">
      <button type="button" disabled={notice.busy} onClick={() => { void notice.resolve(); }}>{notice.busy ? 'Saving…' : approved ? 'Got it' : 'Mark resolved'}</button>
      {!approved && <button type="button" className="is-quiet" onClick={notice.hide}>Hide</button>}
    </div>
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
      toast(decision === 'approved' ? `Approved packet v${packet.version}` : 'Questions sent to the founder');
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
      {packet.review_resolved_at && <><br/>Marked resolved by the founder · {new Date(packet.review_resolved_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>}
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

/** Hidden file picker behind a button; calls `onPick` with the chosen file. */
function UploadButton({ label, accept, disabled, onPick }: { label: string; accept?: string; disabled?: boolean; onPick: (file: File) => void }): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <Button variant="outline" disabled={disabled} onClick={() => input.current?.click()}>{label}</Button>
    <input ref={input} type="file" accept={accept} hidden aria-label={label} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onPick(file); }}/>
  </>;
}

/**
 * Inline preview of an uploaded file: PDFs and images render in place and text files show their contents.
 * Advisors can edit text files, and upload a new version of any file. Every change keeps the earlier version.
 */
export function DocumentPreview({ document: doc }: { document: LiveDocument }): ReactNode {
  const { role } = useRelay();
  const canEdit = role === 'advisor';
  const kind = /\.pdf$/i.test(doc.filename) ? 'pdf' : /\.(png|jpe?g|gif|webp)$/i.test(doc.filename) ? 'image' : isTextFile(doc.filename) ? 'text' : 'other';
  const [content, setContent] = useState<{ key: string; value: string } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // s3_key changes with every new version, so the preview reloads after an edit.
  useEffect(() => {
    if (kind === 'other') return;
    const c = new AbortController();
    setError(null);
    (kind === 'text' ? documentText(doc.id, c.signal) : documentUrl(doc.id, c.signal))
      .then(value => setContent({ key: doc.s3_key, value }))
      .catch((e: unknown) => { if (!c.signal.aborted) setError(errorText(e, 'The file could not be loaded.')); });
    return () => c.abort();
  }, [doc.id, doc.s3_key, kind]);

  async function change(action: () => Promise<unknown>): Promise<void> {
    setBusy(true); setError(null);
    try { await action(); setDraft(null); announceCaseUpdate(); toast(`Saved a new version of ${doc.filename}`); }
    catch (e) { setError(errorText(e, 'The file could not be saved.')); }
    finally { setBusy(false); }
  }

  async function openFile(): Promise<void> {
    const tab = window.open('', '_blank');
    try { const next = await documentUrl(doc.id); if (tab) tab.location.href = next; else window.open(next, '_blank'); }
    catch (e) { tab?.close(); setError(errorText(e, 'The file could not be opened.')); }
  }
  const shown = content?.key === doc.s3_key ? content.value : null;
  return <section className="document-preview" aria-label={`Preview of ${doc.filename}`}>
    {error && <p className="packet-summary-note" role="alert">{error}</p>}
    {draft !== null ? <div className="packet-summary-editor">
        <label htmlFor={`doc-${doc.id}`}>Edit {doc.filename}</label>
        <textarea id={`doc-${doc.id}`} value={draft} onChange={e => setDraft(e.target.value)} rows={18} disabled={busy}/>
      </div>
      : kind === 'other' ? <p className="packet-summary-note">This file type can&apos;t be previewed here.</p>
      : shown === null ? !error && <p className="packet-summary-note" role="status">Loading preview…</p>
      : kind === 'pdf' ? <iframe title={doc.filename} src={shown}/>
      : kind === 'image' ? <img src={shown} alt={doc.filename}/>
      : <pre className="document-preview-text">{shown}</pre>}
    <div className="packet-review-actions">
      {draft !== null ? <>
          <Button disabled={busy || draft === shown} onClick={() => { void change(() => saveDocumentText(doc.id, draft, 'advisor')); }}>{busy ? 'Saving…' : 'Save new version'}</Button>
          <Button variant="outline" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button>
        </>
        : <>
          {canEdit && kind === 'text' && shown !== null && <Button variant="outline" onClick={() => setDraft(shown)}>Edit</Button>}
          {canEdit && <UploadButton label={busy ? 'Uploading…' : 'Upload new version'} disabled={busy} onPick={file => { void change(() => uploadDocumentVersion(doc.id, file, 'advisor')); }}/>}
          <Button variant="outline" onClick={() => { void openFile(); }}>Open in new tab</Button>
        </>}
    </div>
  </section>;
}
