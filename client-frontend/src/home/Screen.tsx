import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BackendWorkspace } from '../workflow/BackendWorkspace';
import { Collapsible, Icon, ScreenState, plainText, timeAgo, useCaseActivity, useCaseChecklist, useCaseDocuments, useRelay } from '@relay/shared';
import type { PacketVersion } from '@relay/shared';
import type { ActivityEntry, ChecklistState } from '../../../frontend-shared/src/relayApi';
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

const checklistLabels: Record<ChecklistState, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
const actorLabels: Record<ActivityEntry['actor'], string> = { agent: 'Relay', founder: 'You', advisor: 'Advisor', system: 'System' };

function DemoScreen() {
  const { snapshot, error, notice } = useRelay();
  const caseDocuments = useCaseDocuments();
  const checklist = useCaseChecklist();
  const activity = useCaseActivity();
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
  const items = checklist.items ?? [];
  const doneCount = items.filter((item) => item.state === 'done').length;
  const nextItem = items.find((item) => item.state !== 'done');
  const fileCount = caseDocuments.documents?.length ?? 0;
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

    <aside className="founder-home-aside" aria-label="Planning progress and activity">
      <div className="founder-home-aside-tabs"><Tabs id="founder-home-aside" label="Workspace details" items={[{ id: 'progress', label: 'Progress' }, { id: 'activity', label: 'Activity' }]} value={asideTab} onChange={(value) => setAsideTab(value as 'progress' | 'activity')}/></div>
      {asideTab === 'progress' ? <div id="founder-home-aside-progress-panel" role="tabpanel" aria-labelledby="founder-home-aside-progress-tab" tabIndex={0} className="founder-home-aside-panel">
        <section aria-labelledby="founder-home-checklist-title">
          <Collapsible id="home-checklist" headingId="founder-home-checklist-title" title="Checklist">
          <p>{doneCount} of {items.length} done · {fileCount} file{fileCount === 1 ? '' : 's'} received</p>
          <div className="founder-home-progress" role="progressbar" aria-label="Checklist items done" aria-valuemin={0} aria-valuemax={items.length || 1} aria-valuenow={doneCount}><span style={{ width: `${items.length ? doneCount / items.length * 100 : 0}%` }}/></div>
          {checklist.error ? <p className="founder-home-empty" role="alert">{checklist.error}</p>
            : checklist.items === null ? <p className="founder-home-empty" role="status">Loading checklist…</p>
            : items.length ? <ul className="founder-home-checklist">{items.map((item) => <li key={item.id}><button type="button" role="checkbox" aria-checked={item.state === 'done'} aria-label={`${item.title}: mark ${item.state === 'done' ? 'not done' : 'done'}`} className={`founder-home-check ${item.state === 'done' ? 'is-done' : ''}`} onClick={() => { void checklist.setState(item.id, item.state === 'done' ? 'todo' : 'done'); }}>{item.state === 'done' ? '✓' : ''}</button><span>{item.title}</span><small>{checklistLabels[item.state]}</small></li>)}</ul>
            : <p className="founder-home-empty">Relay adds items here as you chat about your packet. <Link to="/founder/chat#message-main">Start in AI Chat</Link></p>}
          </Collapsible>
        </section>
        <section className="founder-home-next" aria-labelledby="founder-home-next-title"><Collapsible id="home-next" headingId="founder-home-next-title" title="Next steps">
          {nextItem ? <div className="founder-home-next-step"><span className="founder-home-step-number">{items.indexOf(nextItem) + 1}</span><div><strong>{nextItem.title}</strong>{nextItem.detail && <p>{nextItem.detail}</p>}</div></div>
            : <p className="founder-home-empty">{items.length ? 'Everything on the checklist is done.' : 'Ask Relay what your packet needs to get started.'}</p>}
          {currentQuestion && <Link className="founder-home-chat-link" to="/founder/home/clarification">Answer {snapshot.advisors[0]?.name ?? 'your advisor'}&apos;s question</Link>}
          <Link className="founder-home-packet-link" to="/founder/documents">Review packet versions →</Link>
        </Collapsible></section>
      </div> : <div id="founder-home-aside-activity-panel" role="tabpanel" aria-labelledby="founder-home-aside-activity-tab" tabIndex={0} className="founder-home-aside-panel founder-home-activity-panel">
        <Collapsible id="home-activity" title="Activity">
        {activity.error ? <p className="founder-home-empty" role="alert">{activity.error}</p>
          : activity.entries === null ? <p className="founder-home-empty" role="status">Loading activity…</p>
          : activity.entries.length ? <ul className="founder-home-activity-feed">{activity.entries.map((entry) => <li key={entry.id}><strong>{actorLabels[entry.actor]}</strong><span>{entry.text}</span><small>{timeAgo(entry.created_at)}</small></li>)}</ul>
          : <p className="founder-home-empty">No activity yet. Uploads, checklist changes and Relay&apos;s work show up here.</p>}
        </Collapsible>
        <Collapsible id="home-conversation" as="h3" title="Recent conversation">
        {lastMessages.length ? <ul>{lastMessages.map((message) => <li key={message.id}><strong>{message.author.name}</strong><span className="founder-home-blurb">{plainText(message.text)}</span><small>{timeAgo(message.created_at)}</small></li>)}</ul> : <p>No conversation yet.</p>}
        </Collapsible>
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
