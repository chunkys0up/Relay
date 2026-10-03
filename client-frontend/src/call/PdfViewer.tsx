import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Icon } from '@relay/shared';
import { initializeWorkflowSession, workflowRequest, type WorkflowCase } from '../workflow/api';

interface PdfOption { id: string; label: string; load: (signal: AbortSignal) => Promise<Blob> }

// The backend serves PDFs with `Content-Security-Policy: sandbox`, which stops
// the browser's built-in viewer from rendering them inside an iframe. Loading
// the bytes and viewing a same-origin blob URL keeps the native viewer working.
async function fetchPdf(url: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { credentials: 'same-origin', signal });
  if (!response.ok) throw new Error(`The PDF could not be loaded (${response.status}).`);
  return new Blob([await response.arrayBuffer()], { type: 'application/pdf' });
}

function backendOptions(cases: WorkflowCase[]): PdfOption[] {
  return cases.flatMap(item => [...item.packets].sort((a, b) => b.version - a.version).map(packet => ({
    id: `${item.id}:${packet.id}`,
    label: `${item.company} · packet v${packet.version}`,
    load: (signal: AbortSignal) => fetchPdf(`/api/workflow/cases/${encodeURIComponent(item.id)}/packets/${encodeURIComponent(packet.id)}/download?inline=true`, signal),
  })));
}

export function PdfViewer(): ReactNode {
  const [options, setOptions] = useState<PdfOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [backendNote, setBackendNote] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await initializeWorkflowSession();
        const { items } = await workflowRequest<{ items: WorkflowCase[] }>('/cases');
        if (!active) return;
        const found = backendOptions(items);
        setOptions(current => [...current, ...found]);
        setSelectedId(current => current || found[0]?.id || '');
        if (!found.length) setBackendNote('No generated PDFs yet. Create a PDF draft in the backend workspace, or open a PDF from this computer.');
      } catch {
        if (active) setBackendNote('Generated PDFs are unavailable because the workflow backend is not reachable. You can still open a PDF from this computer.');
      }
    })();
    return () => { active = false; };
  }, []);

  const selected = options.find(option => option.id === selectedId);
  useEffect(() => {
    if (!selected) { setUrl(null); return; }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setLoading(true); setError(null); setUrl(null);
    selected.load(controller.signal).then(blob => {
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The PDF could not be loaded.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selected]);

  function openLocal(file: File | undefined): void {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setError('Choose a PDF file.'); return; }
    const option: PdfOption = { id: `local:${crypto.randomUUID()}`, label: `${file.name} · this computer`, load: () => Promise.resolve(new Blob([file], { type: 'application/pdf' })) };
    setOptions(current => [...current, option]);
    setSelectedId(option.id);
    if (fileInput.current) fileInput.current.value = '';
  }

  return <section className="relay-pdf-viewer" aria-label="PDF viewer">
    <div className="relay-pdf-toolbar">
      <Icon name="file"/>
      {options.length > 0
        ? <select aria-label="PDF to view" value={selectedId} onChange={event => setSelectedId(event.target.value)}>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
        : <strong>No PDF selected</strong>}
      <div className="relay-pdf-actions">
        {url && <a className="button button-outline" href={url} target="_blank" rel="noreferrer">Open in new tab</a>}
        <Button variant="outline" onClick={() => fileInput.current?.click()}>Open PDF…</Button>
        <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden aria-label="Open a PDF from this computer" onChange={event => openLocal(event.target.files?.[0])}/>
      </div>
    </div>
    <div className="relay-pdf-stage">
      {error ? <p role="alert">{error}</p>
        : loading ? <p role="status">Loading PDF…</p>
        : url ? <iframe title={`PDF: ${selected?.label ?? 'document'}`} src={url}/>
        : <p>{backendNote ?? 'Looking for generated PDFs…'}</p>}
    </div>
  </section>;
}
