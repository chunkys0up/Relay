import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Icon, packetUrl, documentUrl, useCaseDocuments, useCasePackets } from '@relay/shared';

type PdfGroup = 'Packet versions' | 'Uploaded documents' | 'This computer';
interface PdfOption { id: string; group: PdfGroup; label: string; load: (signal: AbortSignal) => Promise<string> }
const groups: PdfGroup[] = ['Packet versions', 'Uploaded documents', 'This computer'];

/**
 * Views the case's packet PDFs and uploaded PDFs from S3, or a PDF from this computer.
 * `packetId` selects that packet version whenever it changes.
 */
export function PdfViewer({ packetId }: { packetId?: string }): ReactNode {
  const { packets, error: packetsError } = useCasePackets();
  const { documents } = useCaseDocuments();
  const [localOptions, setLocalOptions] = useState<PdfOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const options: PdfOption[] = [
    ...(packets ?? []).map((packet): PdfOption => ({
      id: `packet:${packet.id}`, group: 'Packet versions', label: `Planning packet v${packet.version}`,
      load: signal => packetUrl(packet.case_id, packet.id, signal),
    })),
    ...(documents ?? []).filter(doc => /\.pdf$/i.test(doc.filename)).map((doc): PdfOption => ({
      id: `doc:${doc.id}`, group: 'Uploaded documents', label: doc.filename,
      load: signal => documentUrl(doc.id, signal),
    })),
    ...localOptions,
  ];

  useEffect(() => { if (packetId) setSelectedId(`packet:${packetId}`); }, [packetId]);
  const selected = options.find(option => option.id === selectedId) ?? options[0];
  const selectedKey = selected?.id ?? '';

  useEffect(() => {
    if (!selected) { setUrl(null); return; }
    const controller = new AbortController();
    setLoading(true); setError(null); setUrl(null);
    selected.load(controller.signal).then(setUrl).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The PDF could not be loaded.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Reload only when the chosen document changes, not on every list refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  function openLocal(file: File | undefined): void {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setError('Choose a PDF file.'); return; }
    const objectUrl = URL.createObjectURL(file);
    const option: PdfOption = { id: `local:${crypto.randomUUID()}`, group: 'This computer', label: `${file.name} · this computer`, load: () => Promise.resolve(objectUrl) };
    setLocalOptions(current => [...current, option]);
    setSelectedId(option.id);
    if (fileInput.current) fileInput.current.value = '';
  }

  return <section className="relay-pdf-viewer" aria-label="PDF viewer">
    <div className="relay-pdf-toolbar">
      <Icon name="file"/>
      {options.length > 0
        ? <select aria-label="PDF to view" value={selectedKey} onChange={event => setSelectedId(event.target.value)}>{groups.map(group => {
            const items = options.filter(option => option.group === group);
            return items.length > 0 && <optgroup key={group} label={group}>{items.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</optgroup>;
          })}</select>
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
        : <p>{packetsError ?? (packets === null ? 'Loading PDFs…' : 'No packet PDFs yet. Open a PDF from this computer.')}</p>}
    </div>
  </section>;
}
