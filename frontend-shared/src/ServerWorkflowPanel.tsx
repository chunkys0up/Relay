import { useEffect, useState } from 'react';
import { getServerCase } from './serverPacketApi';
import { workflowRequest } from '../../client-frontend/src/workflow/api';
import type { PacketField, WorkflowCase } from '../../client-frontend/src/workflow/api';
import { Button, Panel } from './ui';

const fields: PacketField[] = ['company_name', 'founder_name', 'business_summary', 'annual_revenue', 'cash_reserve', 'period'];
const labels: Record<PacketField, string> = { company_name: 'Company name', founder_name: 'Founder name', business_summary: 'Business summary', annual_revenue: 'Annual revenue', cash_reserve: 'Cash reserve', period: 'Reporting period' };
export default function ServerWorkflowPanel({ caseId, revision, refresh }: { caseId: string; revision: number; refresh: () => void }) {
  const [state, setState] = useState<WorkflowCase | null>(null);
  const [goal, setGoal] = useState('Read the original PDFs and extract all six packet facts with exact source citations. Identify missing or conflicting values.');
  const [values, setValues] = useState<Partial<Record<PacketField, string>>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const working = state?.jobs.some(job => job.status === 'queued' || job.status === 'working') ?? false;
  useEffect(() => {
    const controller = new AbortController();
    const load = (): void => { void getServerCase(caseId, controller.signal).then(setState).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load preparation.'); }); };
    load();
    const timer = working ? window.setInterval(load, 2000) : undefined;
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [caseId, revision, working]);
  const act = async (path: string, body: Record<string, unknown>, message: string): Promise<void> => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const latest = await getServerCase(caseId);
      await workflowRequest('/cases/' + encodeURIComponent(caseId) + path, { method: 'POST', body: { ...body, expected_revision: latest.revision } });
      setState(await getServerCase(caseId)); setNotice(message); setAcknowledged(false); refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The request failed.'); }
    finally { setBusy(false); }
  };
  if (!state) return null;
  const currentValues = Object.fromEntries(fields.map(field => [field, values[field] ?? state.pdf_actions?.find(action => action.status === 'pending')?.fields[field] ?? state.facts[field].value ?? state.facts[field].candidates[0]?.value ?? ''])) as Record<PacketField, string>;
  const ready = fields.every(field => state.facts[field].state === 'confirmed') && !state.analysis_required;
  const pending = state.pdf_actions?.find(action => action.status === 'pending');
  return <Panel title="Prepare your packet">
    <p>Read the stored sources, review cited facts, then explicitly save a verified PDF.</p>
    <label>Preparation request<textarea value={goal} onChange={event => setGoal(event.target.value)} maxLength={1000}/></label>
    <Button disabled={busy || working || !state.sources.length || !goal.trim()} onClick={() => { void act('/run', { goal }, 'Source analysis requested.'); }}>{working ? 'Reading sources...' : 'Analyze original sources'}</Button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {state.jobs.at(-1)?.error && <p role="alert">Analysis stopped: {state.jobs.at(-1)?.error}</p>}
    {state.messages.filter(message => message.author === 'Relay').slice(-1).map(message => <p key={message.id}>Last analysis: {message.text}</p>)}
    <details><summary>Review extracted facts and citations</summary>
      {fields.map(field => <div key={field} className="field"><label>{labels[field]}<input value={currentValues[field]} maxLength={1000} onChange={event => { setValues(previous => ({ ...previous, [field]: event.target.value })); setAcknowledged(false); }}/></label><small>{state.facts[field].state}</small>
        {[...state.facts[field].candidates, ...(state.pdf_actions?.find(action => action.status === 'pending')?.changes.filter(change => change.field === field) ?? [])].map((candidate, index) => <div key={index}><strong>{candidate.value}</strong>{candidate.evidence.map((evidence, evidenceIndex) => <blockquote key={evidenceIndex}>{evidence.quote}<br/><small>{state.sources.find(source => source.id === evidence.source_id)?.name ?? 'Founder statement'} · page {evidence.page} · SHA-256 {evidence.source_hash}</small></blockquote>)}</div>)}
      </div>)}
      <label><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/>I reviewed the values and all cited sources, including conflicts.</label>
      <Button disabled={busy || working || !acknowledged || fields.some(field => !currentValues[field].trim())} onClick={() => { void act('/facts/confirm', { values: currentValues, source_acknowledgements: Object.fromEntries(fields.map(field => [field, [...new Set(state.facts[field].candidates.flatMap(candidate => candidate.evidence.map(evidence => evidence.source_id)))]])) }, 'Confirmed facts saved.'); }}>Confirm reviewed facts</Button>
    </details>
    {pending && <p>A proposed PDF is ready. <a href={'/api/workflow/cases/' + encodeURIComponent(caseId) + '/pdf-actions/' + encodeURIComponent(pending.id) + '/preview'} target="_blank" rel="noreferrer">Preview proposed PDF</a> · Verification: {pending.verification?.passed ? 'passed' : 'not passed'}</p>}
    {pending && <Button disabled={busy || working || !acknowledged || fields.some(field => currentValues[field] !== pending.fields[field])} onClick={() => { void act('/pdf-actions/' + encodeURIComponent(pending.id) + '/confirm', { preview_hash: pending.hash }, 'Verified PDF preview saved as a new packet version.'); }}>Save reviewed PDF preview</Button>}<Button disabled={busy || working || !ready} onClick={() => { void act('/packets', { template_id: null }, 'Verified packet PDF saved. Open Documents to inspect it.'); }}>{busy ? 'Working...' : 'Generate and verify packet PDF'}</Button>
    {!ready && <small>Analyze the originals and confirm all six facts before generating.</small>}
  </Panel>;
}
