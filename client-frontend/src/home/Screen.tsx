import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { CaseSidebar, Icon, ScreenState, useCaseDocuments, useRelay } from '@relay/shared';
import type { PacketVersion } from '@relay/shared';
import './styles.css';

type DocumentFilter = 'all' | 'originals' | 'packets';

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function packetStatus(packet: PacketVersion): string {
  if (packet.status === 'approved') return 'Approved';
  if (packet.status === 'in_review') return 'In review';
  if (packet.status === 'questions_returned') return 'Questions returned';
  return 'Draft';
}

function DemoScreen() {
  const { snapshot, error, notice } = useRelay();
  const caseDocuments = useCaseDocuments();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DocumentFilter>('all');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { uploading } = caseDocuments;

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void caseDocuments.upload(files);
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    if (!uploading) void caseDocuments.upload(Array.from(event.dataTransfer.files));
  }

  const normalizedQuery = query.trim().toLowerCase();
  const documents = caseDocuments.documents?.filter((doc) =>
    (filter !== 'packets') && (!normalizedQuery || doc.filename.toLowerCase().includes(normalizedQuery)),
  ) ?? [];
  const packets = snapshot?.packets.filter((packet) =>
    (filter !== 'originals') && (!normalizedQuery || `${packet.title} ${packet.status} v${packet.version}`.toLowerCase().includes(normalizedQuery)),
  ) ?? [];

  return <ScreenState>{snapshot && <div className="founder-home">
    <div className="founder-home-content">
      <header className="founder-home-intro">
        <span className="founder-home-avatar" aria-hidden="true">{initials(snapshot.founder.name)}</span>
        <div><h1>Hi, {snapshot.founder.name.split(' ')[0]}</h1><p>Your {snapshot.company} planning workspace</p></div>
        {snapshot.advisors[0] && <div className="founder-home-advisor"><span>Your advisor</span><strong className="founder-home-advisor-avatar">{initials(snapshot.advisors[0].name)}</strong><span>{snapshot.advisors[0].name}</span><details className="founder-home-advisor-profile"><summary>View profile</summary><div role="group" aria-label="Advisor profile"><strong>{snapshot.advisors[0].name}</strong><span>Advisor</span></div></details></div>}
      </header>

      <section className="founder-home-documents" aria-labelledby="founder-home-documents-title">
        <div className="founder-home-heading"><h2 id="founder-home-documents-title">Your documents</h2><p>Manage the files for your planning packet.</p></div>
        <div className="founder-home-toolbar">
          <label className="founder-home-search"><Icon name="search" size={20}/><span className="sr-only">Search documents</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents…" /></label>
          <div className="founder-home-filters" aria-label="Document type">
            {([['all', 'All documents'], ['originals', 'Original files'], ['packets', 'Packets']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
        </div>

        <div className={`founder-home-dropzone ${dragging ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={onDrop}>
          <span className="founder-home-upload-icon" aria-hidden="true">↑</span>
          <strong>Drop documents here</strong>
          <span>or <button type="button" className="founder-home-text-button" onClick={() => fileInput.current?.click()} disabled={uploading}>choose files</button></span>
          <button className="founder-home-upload-button" type="button" onClick={() => fileInput.current?.click()} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload documents'}</button>
          <input ref={fileInput} className="sr-only" type="file" multiple aria-label="Upload documents" onChange={onFileChange} disabled={uploading}/>
          <small>Upload to this backend case. Sharing with your advisor is a separate step.</small>
        </div>
        {(caseDocuments.error || error) && <p className="founder-home-feedback is-error" role="alert">{caseDocuments.error || error}</p>}
        {notice && <p className="founder-home-feedback" role="status">{notice}</p>}

        <div className="founder-home-file-list" aria-label="Documents">
          <div className="founder-home-file-head"><span>Name</span><span>Type</span><span>Status</span></div>
          {caseDocuments.documents === null && !caseDocuments.error && <p className="founder-home-no-documents" role="status">Loading documents…</p>}
          {documents.map((doc) => <div className="founder-home-file-row" key={doc.id}>
            <button type="button" className="founder-home-file-name" onClick={() => { void caseDocuments.open(doc.id); }}><Icon name="file" size={25}/><span>{doc.filename}</span></button>
            <span>Original</span><span className="founder-home-status is-ready">Uploaded {new Date(doc.uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </div>)}
          {[...packets].reverse().map((packet) => <div className="founder-home-file-row" key={packet.id}>
            <Link className="founder-home-file-name" to={`/founder/documents?version=${encodeURIComponent(packet.id)}`}><Icon name="file" size={25}/><span>{packet.title} v{packet.version}</span></Link>
            <span>Packet</span><span className={`founder-home-status ${packet.status === 'approved' ? 'is-ready' : 'is-draft'}`}>{packetStatus(packet)}</span>
          </div>)}
          {caseDocuments.documents !== null && documents.length + packets.length === 0 && <p className="founder-home-no-documents">{query ? 'No documents match your search.' : 'No documents in this view yet.'}</p>}
        </div>
      </section>
    </div>

    <CaseSidebar footer="Packet versions require a separate handoff to your advisor."/>
  </div>}</ScreenState>;
}

export default function Screen() {
  return <DemoScreen />;
}
