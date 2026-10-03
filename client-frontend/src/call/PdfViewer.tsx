import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Icon } from '@relay/shared';
import { initializeWorkflowSession, workflowRequest, type WorkflowCase } from '../workflow/api';

type PdfGroup = 'Generated packets' | 'Uploaded sources' | 'This computer';
interface PdfOption { id: string; group: PdfGroup; label: string; load: (signal: AbortSignal) => Promise<Blob> }
const groups: PdfGroup[] = ['Generated packets', 'Uploaded sources', 'This computer'];

// The backend serves PDFs with `Content-Security-Policy: sandbox`, which stops
// the browser's built-in viewer from rendering them inside an iframe. Loading
// the bytes and viewing a same-origin blob URL keeps the native viewer working.
async function fetchPdf(url: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(`The PDF could not be loaded (${response.status}).`);
  return new Blob([await response.arrayBuffer()], { type: 'application/pdf' });
}

function backendOptions(cases: WorkflowCase[]): PdfOption[] {
  const base = (item: WorkflowCase) => `/api/workflow/cases/${encodeURIComponent(item.id)}`;
  const packets = cases.flatMap(item => [...item.packets].sort((a, b) => b.version - a.version).map((packet): PdfOption => ({
    id: `${item.id}:${packet.id}`,
    group: 'Generated packets',
    label: `${item.company} · packet v${packet.version}`,
    load: signal => fetchPdf(`${base(item)}/packets/${encodeURIComponent(packet.id)}/download?inline=true`, signal),
  })));
  const sources = cases.flatMap(item => item.sources.filter(source => source.mime_type === 'application/pdf' || source.name.toLowerCase().endsWith('.pdf')).map((source): PdfOption => ({
    id: `${item.id}:source:${source.id}`,
    group: 'Uploaded sources',
    label: `${item.company} · ${source.name}`,
    load: signal => fetchPdf(`${base(item)}/sources/${encodeURIComponent(source.id)}/preview`, signal),
  })));
  return [...packets, ...sources];
}

export function PdfViewer({ caseId, packetId }: { caseId?: string; packetId?: string } = {}): ReactNode {
  const scoped = Boolean(caseId && packetId);
  const [options, setOptions] = useState<PdfOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [backendNote, setBackendNote] = useState<string | null>(null);
  const [url, setUrl] = useState<{ id: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await initializeWorkflowSession();
        const items = scoped
          ? [await workflowRequest<WorkflowCase>(`/cases/${encodeURIComponent(caseId!)}`)]
          : (await workflowRequest<{ items: WorkflowCase[] }>('/cases')).items;
        if (!active) return;
        const found = backendOptions(items).filter(option => !scoped || option.id === `${caseId}:${packetId}`);
        setOptions(current => scoped ? found : [...current.filter(option => !found.some(item => item.id === option.id)), ...found]);
        setSelectedId(current => scoped ? found[0]?.id ?? '' : current || found[0]?.id || '');
        if (!found.length) setBackendNote(scoped ? 'The current shared packet PDF is unavailable.' : 'No PDFs yet. Upload a source or create a PDF draft in the backend workspace, or open a PDF from this computer.');
      } catch {
        if (active) setBackendNote(scoped ? 'The current shared packet PDF is unavailable.' : 'Generated PDFs are unavailable because the workflow backend is not reachable. You can still open a PDF from this computer.');
      }
    })();
    return () => { active = false; };
  }, [caseId, packetId, scoped]);

  const selected = options.find(option => option.id === selectedId && (!scoped || option.id === `${caseId}:${packetId}`));
  useEffect(() => {
    if (!selected) { setUrl(null); return; }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setLoading(true); setError(null); setUrl(null);
    selected.load(controller.signal).then(blob => {
      objectUrl = URL.createObjectURL(blob);
      setUrl({ id: selected.id, value: objectUrl });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The PDF could not be loaded.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selected]);

  function openLocal(file: File | undefined): void {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setError('Choose a PDF file.'); return; }
    const option: PdfOption = { id: `local:${crypto.randomUUID()}`, group: 'This computer', label: `${file.name} · this computer`, load: () => Promise.resolve(new Blob([file], { type: 'application/pdf' })) };
    setOptions(current => [...current, option]);
    setSelectedId(option.id);
    if (fileInput.current) fileInput.current.value = '';
  }

  const activeUrl = url && selected && url.id === selected.id ? url.value : null;

  return <section className="relay-pdf-viewer" aria-label="PDF viewer">
    <div className="relay-pdf-toolbar">
      <Icon name="file"/>
      {options.length > 0
        ? <select aria-label="PDF to view" value={selectedId} onChange={event => setSelectedId(event.target.value)}>{groups.map(group => {
            const items = options.filter(option => option.group === group);
            return items.length > 0 && <optgroup key={group} label={group}>{items.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</optgroup>;
          })}</select>
        : <strong>No PDF selected</strong>}
      <div className="relay-pdf-actions">
        {activeUrl && <a className="button button-outline" href={activeUrl} target="_blank" rel="noreferrer">Open in new tab</a>}
        {!scoped && <><Button variant="outline" onClick={() => fileInput.current?.click()}>Open PDF…</Button>
        <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden aria-label="Open a PDF from this computer" onChange={event => openLocal(event.target.files?.[0])}/></>}
      </div>
    </div>
    <div className="relay-pdf-stage">
      {error ? <p role="alert">{error}</p>
        : loading ? <p role="status">Loading PDF…</p>
        : activeUrl ? <iframe title={`PDF: ${selected?.label ?? 'document'}`} src={activeUrl}/>
        : <p>{backendNote ?? 'Looking for generated PDFs…'}</p>}
    </div>
  </section>;
}
