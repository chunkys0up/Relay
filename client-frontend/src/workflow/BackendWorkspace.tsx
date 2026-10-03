import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@relay/shared';
import { initializeWorkflowSession, workflowRequest, WorkflowRequestError, type PacketField, type PdfAction, type WorkflowCase, type WorkflowSession, type WorkflowSource } from './api';
import './styles.css';

const fields: { id: PacketField; label: string }[] = [
  { id: 'company_name', label: 'Company name' }, { id: 'founder_name', label: 'Founder name' },
  { id: 'business_summary', label: 'Business summary' }, { id: 'annual_revenue', label: 'Annual revenue (USD)' },
  { id: 'cash_reserve', label: 'Cash reserve (USD)' }, { id: 'period', label: 'Reporting period' },
];
const errorText = (error: unknown): string => error instanceof Error ? error.message : 'The request could not be completed.';
interface SendAttempt { caseId: string; text: string; expectedRevision: number; key: string }
const attemptStorageKey = 'relay.backend.pendingSend';
function readSendAttempt(): SendAttempt | null {
  try {
    const value = sessionStorage.getItem(attemptStorageKey);
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const attempt = parsed as Partial<SendAttempt>;
    return typeof attempt.caseId === 'string' && typeof attempt.text === 'string' &&
      typeof attempt.expectedRevision === 'number' && typeof attempt.key === 'string'
      ? attempt as SendAttempt : null;
  } catch { return null; }
}
function saveSendAttempt(attempt: SendAttempt | null): void {
  try {
    if (attempt) sessionStorage.setItem(attemptStorageKey, JSON.stringify(attempt));
    else sessionStorage.removeItem(attemptStorageKey);
  } catch { /* Volatile retry identity still works while the view stays mounted. */ }
}
const fieldLabel = (id: string): string => fields.find(field => field.id === id)?.label ?? id.replaceAll('_', ' ');
const isHumanTask = (party?: string): boolean => ['founder', 'human', 'user', 'client'].includes(party?.toLowerCase() ?? '');
function taskActivity(state: string, party?: string): string {
  const normalized = state.toLowerCase();
  if (!party) return 'Responsible party unknown';
  if (normalized === 'done' || normalized === 'completed') return isHumanTask(party) ? 'Completed by you' : 'Completed by Relay';
  if (isHumanTask(party)) return 'Waiting for you';
  return ['in progress', 'working'].includes(normalized) ? 'Relay working' : 'Relay · waiting';
}

function SourceDetails({ source, caseId }: { source: WorkflowSource; caseId: string }) {
  return <><strong><a href={`/api/workflow/cases/${caseId}/sources/${source.id}/preview`} target="_blank" rel="noreferrer">{source.name}</a></strong>
    <small>{source.excerpt_count} extracted passages · {source.hash.slice(0, 12)}</small>
    {source.extraction_status && <small>Extraction: {source.extraction_status}</small>}
    {source.interpretation_status && <small>Interpretation: {source.interpretation_status}</small>}
    {source.status_detail && <small>{source.status_detail}</small>}
  </>;
}

export function BackendWorkspace({ view }: { view: 'documents' | 'chat' }) {
  const [session, setSession] = useState<WorkflowSession | null>(null);
  const [cases, setCases] = useState<WorkflowCase[]>([]);
  const [current, setCurrent] = useState<WorkflowCase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState('');
  const [goal, setGoal] = useState('');
  const [message, setMessage] = useState(() => readSendAttempt()?.text ?? '');
  const [values, setValues] = useState<Partial<Record<PacketField, string>>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [reviewedAction, setReviewedAction] = useState('');
  const [updates, setUpdates] = useState('Connecting live updates…');
  const latestRevision = useRef(-1);
  const sendAttempt = useRef<SendAttempt | null>(readSendAttempt());
  const fileInput = useRef<HTMLInputElement>(null);
  const templateInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const currentId = useRef<string | null>(null);
  const sequence = useRef(0);
  const applyCase = useCallback((next: WorkflowCase) => {
    if (!mounted.current) return;
    latestRevision.current = currentId.current === next.id ? Math.max(latestRevision.current, next.revision) : next.revision;
    currentId.current = next.id;
    setCurrent(previous => previous?.id === next.id && previous.revision > next.revision ? previous : next);
    try { sessionStorage.setItem('relay.backend.case', next.id); } catch { /* Selection remains usable without browser storage. */ }
  }, []);
  const refresh = useCallback(async (id: string) => {
    const next = await workflowRequest<WorkflowCase>(`/cases/${encodeURIComponent(id)}`);
    if (currentId.current === id) applyCase(next);
    return next;
  }, [applyCase]);
  const bootstrap = useCallback(async () => {
    setLoading(true); setError(null);
    const run = ++sequence.current;
    try {
      const info = await initializeWorkflowSession();
      if (!mounted.current || sequence.current !== run) return;
      setSession(info);
      const { items: list } = await workflowRequest<{ items: WorkflowCase[] }>('/cases');
      if (!mounted.current || sequence.current !== run) return;
      setCases(list);
      let saved: string | null = null;
      try { saved = sessionStorage.getItem('relay.backend.case'); } catch { /* Use the first available case when storage is blocked. */ }
      const selected = list.find(item => item.id === saved) ?? list[0];
      if (selected) {
        currentId.current = selected.id;
        const next = await workflowRequest<WorkflowCase>(`/cases/${encodeURIComponent(selected.id)}`);
        if (mounted.current && sequence.current === run && currentId.current === selected.id) applyCase(next);
      } else {
        currentId.current = null;
        setCurrent(null);
      }
    } catch (cause) { if (mounted.current && sequence.current === run) setError(errorText(cause)); }
    finally { if (mounted.current && sequence.current === run) setLoading(false); }
  }, [applyCase]);
  useEffect(() => { mounted.current = true; void bootstrap(); return () => { mounted.current = false; }; }, [bootstrap]);
  useEffect(() => {
    if (!current?.id || !session) return;
    const id = current.id;
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let attempts = 0;
    const connect = (): void => {
      if (stopped) return;
      const url = new URL(`/api/workflow/cases/${encodeURIComponent(id)}/events`, window.location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);
      socket.onopen = () => {
        socket?.send(JSON.stringify({ csrf_token: session.csrf_token, after_revision: latestRevision.current }));
      };
      socket.onmessage = event => {
        if (stopped || currentId.current !== id) return;
        try {
          const envelope = JSON.parse(String(event.data)) as { type: string; data?: WorkflowCase; message?: string };
          if (envelope.type === 'snapshot' && envelope.data?.id === id) {
            applyCase(envelope.data); setUpdates('Live updates connected');
          } else if (envelope.type === 'ready') { attempts = 0; setUpdates('Live updates connected'); }
          else if (envelope.type === 'error') setUpdates('Live updates unavailable · refresh remains available');
        } catch { setUpdates('Unreadable live update · refresh remains available'); }
      };
      socket.onclose = () => {
        if (stopped) return;
        setUpdates('Live updates disconnected · checking active tasks by refresh');
        retry = window.setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)));
      };
      socket.onerror = () => { /* onclose handles bounded reconnect and visible fallback */ };
    };
    setUpdates('Connecting live updates…'); connect();
    return () => { stopped = true; window.clearTimeout(retry); socket?.close(); };
  }, [current?.id, session, applyCase]);
  const working = current?.jobs.some(job => ['queued', 'working'].includes(job.status)) ?? false;
  useEffect(() => {
    if (!working || !current?.id) return;
    const id = current.id;
    const timer = window.setInterval(() => { void refresh(id).catch(cause => { if (mounted.current) setError(errorText(cause)); }); }, 800);
    return () => window.clearInterval(timer);
  }, [working, current?.id, refresh]);
  useEffect(() => {
    setValues({}); setConfirmed(false); setTemplateId(''); setPreviewId(''); setReviewedAction('');
    if (current?.id && sendAttempt.current?.caseId !== current.id) {
      sendAttempt.current = null; saveSendAttempt(null); setMessage('');
    }
  }, [current?.id]);
  useEffect(() => { setConfirmed(false); setReviewedAction(''); }, [current?.revision]);

  async function action(fn: () => Promise<void>): Promise<void> {
    if (pending.current || working) return;
    pending.current = true;
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); }
    catch (cause) { if (mounted.current) setError(errorText(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    await action(async () => {
      const next = await workflowRequest<WorkflowCase>('/cases', { method: 'POST', body: { company, goal } });
      applyCase(next); setCases(previous => [...previous, next]); setCompany(''); setGoal('');
    });
  }
  async function upload(file: File | undefined, template: boolean): Promise<void> {
    if (!file || !current) return;
    const selected = current;
    let uploaded = false;
    await action(async () => {
      const form = new FormData(); form.append('file', file); form.append('expected_revision', String(selected.revision));
      if (!template) form.append('analyze', 'true');
      const result = await workflowRequest<{ duplicate?: boolean }>(`/cases/${selected.id}/${template ? 'templates' : 'sources'}`, { method: 'POST', file: form });
      uploaded = true;
      await refresh(selected.id);
      setNotice(template ? 'PDF template saved.' : result.duplicate ? 'This exact source was already saved. No duplicate analysis was started.' : 'Source saved. Check its interpretation status and tasks below.');
    });
    if (uploaded && fileInput.current) fileInput.current.value = '';
    if (uploaded && templateInput.current) templateInput.current.value = '';
  }
  async function send(event: FormEvent): Promise<void> {
    event.preventDefault(); if (!current || !message.trim() || pending.current || working) return;
    const selected = current;
    const text = message.trim();
    const attempt = sendAttempt.current?.caseId === selected.id && sendAttempt.current.text === text
      ? sendAttempt.current
      : { caseId: selected.id, text, expectedRevision: selected.revision, key: crypto.randomUUID() };
    sendAttempt.current = attempt; saveSendAttempt(attempt);
    await action(async () => {
      try {
        await workflowRequest(`/cases/${selected.id}/run`, { method: 'POST', key: attempt.key, body: { expected_revision: attempt.expectedRevision, goal: text } });
      } catch (cause) {
        if (cause instanceof WorkflowRequestError && cause.status < 500) {
          sendAttempt.current = null; saveSendAttempt(null);
        }
        throw cause;
      }
      sendAttempt.current = null; saveSendAttempt(null); setMessage(''); await refresh(selected.id);
    });
  }
  async function decideRelationship(source: WorkflowSource, decision: 'revision' | 'separate'): Promise<void> {
    if (!current || !source.relationship_suggestion) return;
    const selected = current;
    await action(async () => {
      await workflowRequest(`/cases/${selected.id}/sources/${source.id}/relationship`, {
        method: 'POST',
        body: { expected_revision: selected.revision, related_source_id: source.relationship_suggestion?.related_source_id, decision },
      });
      await refresh(selected.id);
    });
  }
  async function confirmFacts(event: FormEvent): Promise<void> {
    event.preventDefault(); if (!current || !confirmed) return;
    const selected = current;
    const submitted: Partial<Record<PacketField, string>> = {};
    const acknowledgements: Partial<Record<PacketField, string[]>> = {};
    for (const field of fields) {
      const value = values[field.id] ?? selected.facts[field.id]?.value ?? '';
      if (value.trim()) {
        submitted[field.id] = value.trim();
        acknowledgements[field.id] = [...new Set((selected.facts[field.id]?.candidates ?? []).flatMap(candidate => candidate.evidence.map(item => item.source_id)))];
      }
    }
    await action(async () => {
      await workflowRequest(`/cases/${selected.id}/facts/confirm`, { method: 'POST', body: { expected_revision: selected.revision, values: submitted, source_acknowledgements: acknowledgements } });
      setValues({}); setConfirmed(false); await refresh(selected.id);
    });
  }
  async function draft(): Promise<void> {
    if (!current) return;
    const selected = current;
    await action(async () => {
      const result = await workflowRequest<{ packet_id: string }>(`/cases/${selected.id}/packets`, { method: 'POST', body: { expected_revision: selected.revision, ...(templateId ? { template_id: templateId } : {}) } });
      await refresh(selected.id); setPreviewId(result.packet_id);
    });
  }
  async function resolvePdfAction(proposal: PdfAction, decision: 'confirm' | 'dismiss'): Promise<void> {
    if (!current || proposal.status !== 'pending') return;
    const selected = current;
    if (decision === 'confirm' && (reviewedAction !== proposal.id || proposal.created_revision !== selected.revision || hasEdits)) return;
    await action(async () => {
      const result = await workflowRequest<{ packet_id?: string }>(`/cases/${selected.id}/pdf-actions/${proposal.id}/${decision}`, {
        method: 'POST', body: { expected_revision: selected.revision, preview_hash: proposal.hash },
      });
      setReviewedAction('');
      await refresh(selected.id);
      if (result.packet_id) setPreviewId(result.packet_id);
    });
  }
  const disabled = busy || working;
  const orderedTasks = [...(current?.tasks ?? [])].sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER));
  const taskTitles = new Map<string, string>();
  for (const task of orderedTasks) {
    taskTitles.set(task.id, task.title);
    if (task.key) taskTitles.set(task.key, task.title);
  }
  const hasEdits = fields.some(field => values[field.id] !== undefined && values[field.id] !== current?.facts[field.id]?.value);
  const packetUrl = current && previewId ? `/api/workflow/cases/${current.id}/packets/${previewId}/download` : null;
  return <section className="backend-workspace" aria-label="Backend packet workspace">
    <header><div><h1>{view === 'documents' ? 'Your packet workspace' : 'AI Chat'}</h1><p>{view === 'documents' ? 'Upload evidence, then prepare your packet in AI Chat.' : 'Tell Relay what you need. Review every proposed field before drafting.'}</p></div><Link to={`/founder/${view === 'documents' ? 'home' : 'chat'}`}>Return to local demo</Link></header>
    <div className="backend-mode"><strong>{session?.mode === 'simulated' ? 'Simulated AI · test provider' : session?.mode === 'live' ? 'Bedrock configured · live requests on submit' : 'Bedrock not configured'}</strong><p>Isolated development workspace · saved in the backend’s local SQLite store. No advisor sharing or approvals. Use fictional documents only.</p><div className="backend-actions"><Link to="/founder/home?workspace=backend">Documents and uploads</Link><Link to="/founder/chat?workspace=backend">AI Chat and PDF drafts</Link></div></div>
    {error && <div className="backend-error" role="alert">{error}<p>A failed response does not prove a change was undone. Refresh to check saved state before retrying.</p><Button variant="outline" onClick={() => { void bootstrap(); }}>Refresh backend workspace</Button></div>}
    {notice && <p className="backend-notice" role="status">{notice}</p>}
    {loading && <p role="status">Loading backend workspace…</p>}
    {!loading && session && <>
      <div className="backend-card"><label>Backend case<select value={current?.id ?? ''} disabled={disabled} onChange={event => { currentId.current = event.target.value; latestRevision.current = -1; void refresh(event.target.value).catch(cause => setError(errorText(cause))); }}><option value="" disabled>Select a case</option>{cases.map(item => <option key={item.id} value={item.id}>{item.company}</option>)}</select></label>
        <details open={!current}><summary>Create a fictional case</summary><form onSubmit={event => { void create(event); }}><label>Company name<input value={company} onChange={event => setCompany(event.target.value)} maxLength={120} required /></label><label>What would you like to prepare?<textarea value={goal} onChange={event => setGoal(event.target.value)} maxLength={1000} required /></label><Button type="submit" disabled={disabled}>Create backend case</Button></form></details>
      </div>
      {current && <div className="backend-columns"><div>
        {view === 'documents' ? <>
          <section className="backend-card"><h2>Source documents</h2><p>Text, CSV and text-based PDFs, up to 10 MB. Scanned PDFs need an extraction service; unsupported files fail explicitly. Analysis supports up to 49 source passages of 1,200 characters each. For larger evidence sets, create a new case with smaller files.</p><label>Add source document<input ref={fileInput} type="file" accept=".txt,.csv,.pdf" disabled={disabled} onChange={event => { void upload(event.target.files?.[0], false); }} /></label><ul className="backend-list">{current.sources.map(source => <li key={source.id}><SourceDetails source={source} caseId={current.id} /></li>)}</ul>{!current.sources.length && <p>No evidence uploaded yet.</p>}</section>
          <section className="backend-card"><h2>Optional fillable PDF template</h2><p>Use an unsigned text-field AcroForm with the supported field names: {fields.map(field => field.id).join(', ')}. Original templates stay unchanged.</p><label>Add PDF template<input ref={templateInput} type="file" accept=".pdf" disabled={disabled} onChange={event => { void upload(event.target.files?.[0], true); }} /></label><ul className="backend-list">{current.templates?.map(template => <li key={template.id}><strong>{template.name}</strong><small>{template.fields.join(', ')}</small></li>)}</ul></section>
          <Link className="button" to="/founder/chat?workspace=backend">Continue in AI Chat</Link>
        </> : <>
          <section className="backend-card"><h2>Private conversation</h2>{current.messages.map(item => <article className="backend-message" key={item.id}><strong>{item.author === 'founder' ? 'You · Founder' : 'Relay AI'}</strong>{item.text}<br/><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time></article>)}
            {!!current.flags.length && <div className="backend-questions"><h3>Relay needs your input</h3>{current.flags.map((flag, index) => <p key={`${flag.field}-${index}`}><strong>{fieldLabel(flag.field)}:</strong> {flag.question ?? flag.detail} Review the evidence and enter your answer in the field below, then confirm it.</p>)}</div>}
            <form onSubmit={event => { void send(event); }}><label>Message Relay about this packet<textarea value={message} onChange={event => { setMessage(event.target.value); sendAttempt.current = null; saveSendAttempt(null); }} maxLength={1000} disabled={disabled} required /></label><Button type="submit" disabled={disabled || session.mode === 'unconfigured' || !message.trim()}>{working ? 'Analyzing…' : session.mode === 'simulated' ? 'Analyze with test AI' : 'Analyze with Bedrock'}</Button></form>
            <div className="backend-chat-sources"><h3>Sources and interpretation</h3><label>Add source in chat<input ref={view === 'chat' ? fileInput : undefined} type="file" accept=".txt,.csv,.pdf" disabled={disabled} onChange={event => { void upload(event.target.files?.[0], false); }} /></label>
              <ul className="backend-list">{current.sources.map(source => <li key={source.id}><SourceDetails source={source} caseId={current.id} />
                {source.relationship_suggestion && !source.relationship && <div className="backend-relationship" aria-label={`Possible replacement for ${source.name}`}><p>Relay suggests this may replace <strong>{current.sources.find(item => item.id === source.relationship_suggestion?.related_source_id)?.name ?? 'an earlier source'}</strong>. {source.relationship_suggestion.reason} Both originals remain available.</p><div className="backend-actions"><Button disabled={disabled} onClick={() => { void decideRelationship(source, 'revision'); }}>Confirm replacement relationship</Button><Button variant="outline" disabled={disabled} onClick={() => { void decideRelationship(source, 'separate'); }}>Keep as separate source</Button></div></div>}
                {source.relationship && <small>Relationship recorded: {source.relationship.decision === 'revision' ? 'replaces an earlier source' : 'separate source'}.</small>}
              </li>)}</ul>{!current.sources.length && <p>No source documents yet.</p>}
            </div>
          </section>
          {current.pdf_actions?.map(proposal => {
            const stale = proposal.created_revision !== current.revision;
            const pendingProposal = proposal.status === 'pending';
            const previewUrl = `/api/workflow/cases/${current.id}/pdf-actions/${proposal.id}/preview`;
            return <section className="backend-card backend-pdf-action" key={proposal.id} aria-label={`Proposed PDF version ${proposal.version}`}>
              <h2>AI proposed PDF · v{proposal.version}</h2>
              <p className="backend-proposal-status" role="status">{pendingProposal ? 'Proposed · not saved as a packet' : `Proposal ${proposal.status}`}</p>
              {proposal.verification?.passed && <p role="status">PDF checks passed · {proposal.verification.mode === 'deterministic+agent' ? 'document content and field checks completed' : 'field checks completed'}. Your review is still required.</p>}
              <p>{proposal.base_packet_id ? 'Review the changes to your existing packet.' : 'Review the fields for this new packet.'} Saving creates a new immutable version and preserves earlier packets.</p>
              <dl className="backend-proposal-fields">{fields.map(field => <div key={field.id}><dt>{field.label}{proposal.changes.some(change => change.field === field.id) ? ' · proposed change' : ' · unchanged'}</dt><dd>{proposal.fields[field.id]}</dd></div>)}</dl>
              <details><summary>Evidence for proposed changes</summary>{proposal.changes.map(change => <div className="backend-evidence" key={change.field}><strong>{fields.find(field => field.id === change.field)?.label}: {change.value}</strong>{change.evidence.map((evidence, index) => <div key={index}><span>{current.sources.find(source => source.id === evidence.source_id)?.name ?? 'User input'} · page {evidence.page} · {evidence.source_hash.slice(0, 10)}</span><blockquote>{evidence.quote}</blockquote></div>)}</div>)}</details>
              {pendingProposal && !stale && <p><a href={previewUrl} target="_blank" rel="noreferrer">Open proposed PDF preview in a new tab</a></p>}
              {pendingProposal && <>{!stale && <details><summary>Show embedded PDF preview</summary><p>If the preview is blank, open the PDF in a new tab using the link above.</p><iframe title={`Proposed PDF v${proposal.version} preview`} className="backend-preview" src={previewUrl} /></details>}
                {stale && <p role="status">This proposal is out of date because the case changed. Ask Relay for a fresh proposal before saving.</p>}
                {hasEdits && <p role="status">You have unsaved manual field edits. Confirm or clear those edits, then request a fresh proposal.</p>}
                <label className="backend-confirm"><input type="checkbox" checked={reviewedAction === proposal.id} disabled={disabled || stale || hasEdits} onChange={event => setReviewedAction(event.target.checked ? proposal.id : '')} />I reviewed this PDF preview, its proposed values, and the supporting evidence. Save these values in a new PDF version.</label>
                <div className="backend-actions"><Button disabled={disabled || stale || hasEdits || reviewedAction !== proposal.id} onClick={() => { void resolvePdfAction(proposal, 'confirm'); }}>Save reviewed PDF version</Button><Button variant="outline" disabled={disabled} onClick={() => { void resolvePdfAction(proposal, 'dismiss'); }}>Dismiss proposal</Button></div>
              </>}
            </section>;
          })}
          <section className="backend-card"><h2>Review proposed fields</h2><p>Source conflicts stay visible. Edit or supply missing values, inspect evidence, then confirm your choices. Nothing is filled automatically.</p><form onSubmit={event => { void confirmFacts(event); }}>{fields.map(field => {
            const fact = current.facts[field.id];
            return <div className="backend-field" key={field.id}><label>{field.label}<input value={values[field.id] ?? fact?.value ?? ''} disabled={disabled} maxLength={field.id === 'business_summary' ? 1000 : 200} onChange={event => { setValues(previous => ({ ...previous, [field.id]: event.target.value })); setConfirmed(false); setReviewedAction(''); }} /></label><small>{fact?.state ?? 'unknown'}</small>{fact?.candidates.map((candidate, index) => <div className="backend-evidence" key={index}><strong>AI proposes: {candidate.value}</strong>{candidate.evidence.map((evidence, item) => <div key={item}><span>{current.sources.find(source => source.id === evidence.source_id)?.name ?? 'User input'} · page {evidence.page} · {evidence.source_hash.slice(0, 10)}</span><blockquote>{evidence.quote}</blockquote></div>)}</div>)}</div>;
          })}<label className="backend-confirm"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={event => setConfirmed(event.target.checked)} />I reviewed the displayed evidence and conflicts. Record these values as my confirmed input.</label><Button type="submit" disabled={disabled || !confirmed}>Confirm reviewed values</Button></form></section>
          <section className="backend-card"><h2>Create a PDF draft</h2>{current.analysis_required && <p role="status">Analyze the new evidence and review its proposals before drafting.</p>}{hasEdits && <p role="status">Confirm your edited values before creating a draft.</p>}<p>A draft is a new immutable version, not an advisor approval.</p><label>PDF layout<select value={templateId} onChange={event => setTemplateId(event.target.value)} disabled={disabled}><option value="">Relay planning packet</option>{current.templates?.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><div className="backend-actions"><Button disabled={disabled || current.analysis_required || hasEdits || fields.some(field => current.facts[field.id]?.state !== 'confirmed')} onClick={() => { void draft(); }}>Create confirmed PDF draft</Button></div><ul className="backend-list">{current.packets.map(packet => <li key={packet.id}><strong>Packet v{packet.version}</strong><small>{packet.hash.slice(0, 16)}</small><div className="backend-actions"><Button variant="outline" onClick={() => setPreviewId(packet.id)}>Preview v{packet.version}</Button><a href={`/api/workflow/cases/${current.id}/packets/${packet.id}/download`}>Download v{packet.version}</a></div></li>)}</ul>{packetUrl && <><p>PDF preview. Use Download if your browser does not display PDFs.</p><iframe title="Confirmed PDF draft preview" className="backend-preview" src={packetUrl + '?inline=true'}/></>}</section>
        </>}
      </div><aside><section className="backend-card" aria-label="Backend task progress"><h2>Your next steps</h2><small role="status">{updates}</small><p role="status">{current.ui_state} · {current.status}</p><ol className="backend-list">{orderedTasks.map(task => <li key={task.id}><div className="backend-task"><strong>{task.title}</strong><span>{task.state}</span></div><small>{taskActivity(task.state, task.responsible_party)}</small>{task.detail && <small>{task.detail}</small>}{!!task.dependencies?.length && <small>After: {task.dependencies.map(id => taskTitles.get(id) ?? id).join(', ')}</small>}{task.blocking_reason && <small>Blocked: {task.blocking_reason}</small>}{task.completion_condition && <small>Done when: {task.completion_condition}</small>}</li>)}</ol>{!current.tasks.length && <p>Send your goal to create an analysis task list.</p>}{current.jobs.filter(job => job.error).map(job => <p role="alert" key={job.id}>{job.error}</p>)}</section><section className="backend-card"><h2>Details needing input</h2><ul className="backend-list">{current.flags.map((flag, index) => <li key={index}><strong>{flag.field.replaceAll('_', ' ')}</strong>{flag.detail}</li>)}</ul></section></aside></div>}
    </>}
  </section>;
}
