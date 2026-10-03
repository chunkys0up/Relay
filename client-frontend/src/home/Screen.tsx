import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { Icon, ScreenState, useRelay } from '@relay/shared';
import type { PacketVersion, Source, Task } from '@relay/shared';
import { fileContentBase64 } from '../../../frontend-shared/src/intake';
import { Tabs } from '../../../frontend-shared/src/tabs';
import './styles.css';

type DocumentFilter = 'all' | 'originals' | 'packets';

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function sourceStatus(source: Source): string {
  if (source.extraction === 'ready') return 'Received';
  if (source.extraction === 'failed' || source.extraction === 'unsupported') return 'Needs attention';
  return 'Processing';
}

function packetStatus(packet: PacketVersion): string {
  if (packet.status === 'approved') return 'Approved';
  if (packet.status === 'in_review') return 'In review';
  if (packet.status === 'questions_returned') return 'Questions returned';
  return 'Draft';
}

function taskStatus(task: Task): string {
  if (task.state === 'Done') return 'Done';
  if (task.state === 'Blocked') return 'Needs input';
  return task.state;
}

export default function Screen() {
  const { snapshot, busy, error, notice, run } = useRelay();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DocumentFilter>('all');
  const [asideTab, setAsideTab] = useState<'progress' | 'activity'>('progress');
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File): Promise<void> {
    if (!snapshot || busy) return;
    setUploadError(null);
    try {
      const content_base64 = await fileContentBase64(file);
      const saved = await run({
        kind: 'upload', expected_revision: snapshot.revision, name: file.name,
        mime_type: file.type, bytes: file.size, content_base64,
      });
      if (saved) setSelectedFile(null);
    } catch (caught: unknown) {
      setUploadError(caught instanceof Error ? caught.message : 'Unable to read this file.');
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) { setSelectedFile(file); setUploadError(null); }
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) { setSelectedFile(file); setUploadError(null); }
  }

  const normalizedQuery = query.trim().toLowerCase();
  const sources = snapshot?.sources.filter((source) =>
    (filter !== 'packets') && (!normalizedQuery || `${source.name} ${source.excerpt}`.toLowerCase().includes(normalizedQuery)),
  ) ?? [];
  const packets = snapshot?.packets.filter((packet) =>
    (filter !== 'originals') && (!normalizedQuery || `${packet.title} ${packet.status} v${packet.version}`.toLowerCase().includes(normalizedQuery)),
  ) ?? [];
  const tasks = [...(snapshot?.tasks ?? [])].sort((a, b) => a.order - b.order);
  const doneCount = tasks.filter((task) => task.state === 'Done').length;
  const firstOpenTask = tasks.find((task) => task.state !== 'Done');
  const currentFlags = snapshot?.flags.filter((flag) => flag.packet_version_id === snapshot.current_packet_version_id && !flag.resolved) ?? [];
  const currentQuestion = snapshot?.clarifications.find((question) => question.packet_version_id === snapshot.current_packet_version_id && question.status === 'sent');
  const lastMessages = snapshot?.messages.filter((message) => message.owner_id === snapshot.founder.id).slice(-3).reverse() ?? [];

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
          <span>or <button type="button" className="founder-home-text-button" onClick={() => fileInput.current?.click()} disabled={busy}>choose files</button></span>
          <button className="founder-home-upload-button" type="button" onClick={() => fileInput.current?.click()} disabled={busy}>{busy ? 'Adding document…' : 'Upload documents'}</button>
          <input ref={fileInput} className="sr-only" type="file" aria-label="Attach a source" onChange={onFileChange} disabled={busy}/>
          <small>Files stay in this browser. Text and CSV previews are supported; maximum 10 MB per file.</small>
        </div>
        {selectedFile && <div className="founder-home-upload-confirm" role="group" aria-label="Confirm local upload"><strong>Selected locally: {selectedFile.name}</strong><p>{Math.max(1, Math.round(selectedFile.size / 1024))} KB · Add actual bytes to this browser only. UTF-8 text and CSV previews are supported; PDF and binary extraction is unavailable.</p><div><button type="button" className="founder-home-upload-button" onClick={() => { void uploadFile(selectedFile); }} disabled={busy}>Add source locally</button><button type="button" className="founder-home-cancel-button" onClick={() => { setSelectedFile(null); setUploadError(null); }} disabled={busy}>Cancel attachment</button></div></div>}
        {(uploadError || error) && <p className="founder-home-feedback is-error" role="alert">{uploadError || error}</p>}
        {notice && <p className="founder-home-feedback" role="status">{notice}</p>}

        <div className="founder-home-file-list" aria-label="Documents">
          <div className="founder-home-file-head"><span>Name</span><span>Type</span><span>Status</span></div>
          {sources.map((source) => <div className="founder-home-file-row" key={source.id}>
            <Link className="founder-home-file-name" to={`/founder/sources?source=${encodeURIComponent(source.id)}`}><Icon name="file" size={25}/><span>{source.name}</span></Link>
            <span>Original</span><span className={`founder-home-status ${source.extraction === 'ready' ? 'is-ready' : 'is-attention'}`}>{sourceStatus(source)}</span>
          </div>)}
          {[...packets].reverse().map((packet) => <div className="founder-home-file-row" key={packet.id}>
            <Link className="founder-home-file-name" to={`/founder/documents?version=${encodeURIComponent(packet.id)}`}><Icon name="file" size={25}/><span>{packet.title} v{packet.version}</span></Link>
            <span>Packet</span><span className={`founder-home-status ${packet.status === 'approved' ? 'is-ready' : 'is-draft'}`}>{packetStatus(packet)}</span>
          </div>)}
          {sources.length + packets.length === 0 && <p className="founder-home-no-documents">{query ? 'No documents match your search.' : 'No documents in this view yet.'}</p>}
        </div>
      </section>
    </div>

    <aside className="founder-home-aside" aria-label="Planning progress and activity">
      <div className="founder-home-aside-tabs"><Tabs id="founder-home-aside" label="Workspace details" items={[{ id: 'progress', label: 'Progress' }, { id: 'activity', label: 'Activity' }]} value={asideTab} onChange={(value) => setAsideTab(value as 'progress' | 'activity')}/></div>
      {asideTab === 'progress' ? <div id="founder-home-aside-progress-panel" role="tabpanel" aria-labelledby="founder-home-aside-progress-tab" tabIndex={0} className="founder-home-aside-panel">
        <section aria-labelledby="founder-home-checklist-title">
          <h2 id="founder-home-checklist-title">Document checklist</h2>
          <p>{doneCount} of {tasks.length} planning steps complete · {snapshot.sources.length} original file{snapshot.sources.length === 1 ? '' : 's'} received</p>
          <div className="founder-home-progress" role="progressbar" aria-label="Planning tasks complete" aria-valuemin={0} aria-valuemax={tasks.length || 1} aria-valuenow={doneCount}><span style={{ width: `${tasks.length ? doneCount / tasks.length * 100 : 0}%` }}/></div>
          {tasks.length ? <ul className="founder-home-checklist">{tasks.map((task) => <li key={task.id}><span className={`founder-home-check ${task.state === 'Done' ? 'is-done' : ''}`} aria-hidden="true">{task.state === 'Done' ? '✓' : ''}</span><span>{task.title}</span><small>{taskStatus(task)}</small></li>)}</ul> : <p className="founder-home-empty">Planning tasks will appear here as work begins.</p>}
        </section>
        <section className="founder-home-next" aria-labelledby="founder-home-next-title"><h2 id="founder-home-next-title">Next steps</h2>
          {firstOpenTask ? <div className="founder-home-next-step"><span className="founder-home-step-number">{firstOpenTask.order}</span><div><strong>{firstOpenTask.title}</strong><p>{firstOpenTask.detail}</p><Link className="founder-home-chat-link" to={currentQuestion ? '/founder/home/clarification' : '/founder/chat#message-main'}>{currentQuestion ? 'Answer clarification in chat' : 'Open AI Chat'}</Link></div></div> : <p className="founder-home-empty">All current planning tasks are complete.</p>}
          {currentFlags.length > 0 && <p className="founder-home-open-flags">{currentFlags.length} detail{currentFlags.length === 1 ? '' : 's'} to confirm before the next packet revision.</p>}
          <Link className="founder-home-packet-link" to="/founder/documents">Review packet versions →</Link>
        </section>
      </div> : <div id="founder-home-aside-activity-panel" role="tabpanel" aria-labelledby="founder-home-aside-activity-tab" tabIndex={0} className="founder-home-aside-panel founder-home-activity-panel">
        <h2>Current activity</h2><p className="founder-home-activity-current">{snapshot.activity ?? 'Waiting for your next step.'}</p>
        <p className="founder-home-case-status">Case status: {snapshot.status}</p>
        <h3>Recent conversation</h3>
        {lastMessages.length ? <ul>{lastMessages.map((message) => <li key={message.id}><strong>{message.author.name}</strong><span>{message.text}</span><small>{new Date(message.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></li>)}</ul> : <p>No conversation activity yet.</p>}
        <Link className="founder-home-chat-link" to="/founder/chat#message-main">Open AI Chat</Link>
      </div>}
      <p className="founder-home-privacy">Uploads stay private until you choose what to share.</p>
    </aside>
  </div>}</ScreenState>;
}
