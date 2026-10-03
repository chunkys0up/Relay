import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BackendWorkspace } from '../workflow/BackendWorkspace';
import { Icon, ScreenState, useCaseDocuments, useRelay } from '@relay/shared';
import type { PacketVersion, Task } from '@relay/shared';
import { Tabs } from '../../../frontend-shared/src/tabs';
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

function taskStatus(task: Task): string {
  if (task.state === 'Done') return 'Done';
  if (task.state === 'Blocked') return 'Needs input';
  return task.state;
}

function DemoScreen() {
  const { snapshot, error, notice } = useRelay();
  const caseDocuments = useCaseDocuments();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DocumentFilter>('all');
  const [asideTab, setAsideTab] = useState<'progress' | 'activity'>('progress');
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
          <span>or <button type="button" className="founder-home-text-button" onClick={() => fileInput.current?.click()} disabled={uploading}>choose files</button></span>
          <button className="founder-home-upload-button" type="button" onClick={() => fileInput.current?.click()} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload documents'}</button>
          <input ref={fileInput} className="sr-only" type="file" multiple aria-label="Upload documents" onChange={onFileChange} disabled={uploading}/>
          <small>Uploaded originals are visible to your advisor. Packet sharing is separate.</small>
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

    <aside className="founder-home-aside" aria-label="Planning progress and activity">
      <div className="founder-home-aside-tabs"><Tabs id="founder-home-aside" label="Workspace details" items={[{ id: 'progress', label: 'Progress' }, { id: 'activity', label: 'Activity' }]} value={asideTab} onChange={(value) => setAsideTab(value as 'progress' | 'activity')}/></div>
      {asideTab === 'progress' ? <div id="founder-home-aside-progress-panel" role="tabpanel" aria-labelledby="founder-home-aside-progress-tab" tabIndex={0} className="founder-home-aside-panel">
        <section aria-labelledby="founder-home-checklist-title">
          <h2 id="founder-home-checklist-title">Document checklist</h2>
          <p>{doneCount} of {tasks.length} planning steps complete · {caseDocuments.documents?.length ?? 0} original file{caseDocuments.documents?.length === 1 ? '' : 's'} received</p>
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
      <p className="founder-home-privacy">Packet versions require a separate handoff to your advisor.</p>
    </aside>
  </div>}</ScreenState>;
}

export default function Screen() {
  const [params] = useSearchParams();
  if (params.get('workspace') === 'backend') return <BackendWorkspace view="documents" />;
  return <><div className="backend-workspace-entry"><Link to="/founder/home?workspace=backend">Open backend packet workspace</Link><span>Separate development workspace · Bedrock configuration required</span></div><DemoScreen /></>;
}
