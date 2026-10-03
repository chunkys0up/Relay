import { useEffect, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CallControls } from './call';
import { onJoinRequest } from './callPresence';
import { Collapsible } from './collapsible';
import { Conversation } from './conversation';
import type { ChatThread } from './conversation';
import { useRelay } from './context';
import { packetStatus, useCasePackets, useReviewNotice } from './packets';
import { Tabs } from './tabs';
import { toast } from './toast';
import { Icon } from './ui';
import { plainText, timeAgo, useCaseActivity, useCaseChecklist, useCaseDocuments, useRecentMessages } from './live';
import type { CaseChecklist } from './live';
import type { ActivityEntry, ChecklistItem, ChecklistState } from './relayApi';
import './chatPage.css';
import './caseSidebar.css';

const checklistLabels: Record<ChecklistState, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };
const actorLabels: Record<ActivityEntry['actor'], string> = { agent: 'Relay', founder: 'You', advisor: 'Advisor', system: 'System' };

const WIDTH_KEY = 'relay-sidebar-width';
const TAB_KEY = 'relay-sidebar-tab';
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;
const MAX_WIDTH = 640;

function clampWidth(width: number): number {
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));
}

function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function store(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* remembered for this visit only */ }
}

/**
 * A right-hand sidebar whose left edge drags to resize. The width is shared by every
 * screen that shows one, so sidebars line up as you move between screens.
 */
export function ResizableSidebar({ label, className = '', children }: { label: string; className?: string; children: ReactNode }): ReactNode {
  const [width, setWidth] = useState(() => clampWidth(Number(readStored(WIDTH_KEY)) || DEFAULT_WIDTH));
  const resize = (next: number): void => { const clamped = clampWidth(next); setWidth(clamped); store(WIDTH_KEY, String(clamped)); };

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent): void => resize(startWidth + startX - moveEvent.clientX);
    const stop = (): void => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', stop); document.body.classList.remove('is-resizing-sidebar'); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    document.body.classList.add('is-resizing-sidebar');
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === 'ArrowLeft') resize(width + step);
    else if (event.key === 'ArrowRight') resize(width - step);
    else return;
    event.preventDefault();
  }

  return <div className={`case-sidebar ${className}`} style={{ width }}>
    <div className="case-sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width} tabIndex={0} onPointerDown={onPointerDown} onKeyDown={onKeyDown} onDoubleClick={() => resize(DEFAULT_WIDTH)}/>
    <aside className="case-sidebar-body" aria-label={label}>{children}</aside>
  </div>;
}

/**
 * The founder's case sidebar: Progress (checklist, next steps, case details), Call and Activity tabs.
 * Every tab stays mounted while hidden, so switching tabs never drops a live call.
 */
export function CaseSidebar({ footer, onLiveCallChange }: { footer?: ReactNode; onLiveCallChange?: (active: boolean) => void }): ReactNode {
  const checklist = useCaseChecklist();
  const [tab, setTab] = useState(() => readStored(TAB_KEY) ?? 'progress');
  // Joining from the incoming-call notice brings the Call tab forward.
  useEffect(() => onJoinRequest(() => { setTab('call'); store(TAB_KEY, 'call'); }), []);
  const tabs = [
    { id: 'progress', label: 'Progress', content: <><ChecklistSection id="sidebar-checklist" checklist={checklist}/><NextStepsSection id="sidebar-next" checklist={checklist}/><CaseDetailsSection id="sidebar-case"/></> },
    { id: 'call', label: 'Call', content: <CallPanel onLiveCallChange={onLiveCallChange}/> },
    { id: 'activity', label: 'Activity', content: <><ActivitySection id="sidebar-activity"/><RecentConversationSection id="sidebar-conversation"/></> },
  ];
  const current = tabs.find((item) => item.id === tab) ?? tabs[0];
  return <ResizableSidebar label="Planning progress and activity">
    <div className="case-sidebar-tabs"><Tabs id="case-sidebar" label="Workspace details" items={tabs} value={current.id} onChange={(next) => { setTab(next); store(TAB_KEY, next); }}/></div>
    {tabs.map((item) => <div key={item.id} id={`case-sidebar-${item.id}-panel`} role="tabpanel" aria-labelledby={`case-sidebar-${item.id}-tab`} tabIndex={0} className="case-sidebar-panel" hidden={item.id !== current.id}>{item.content}</div>)}
    {footer && <p className="case-sidebar-footer">{footer}</p>}
  </ResizableSidebar>;
}

/** A private AI chat with Relay in the resizable sidebar, styled like the full AI Chat page. */
export function AssistantSidebar({ subtitle }: { subtitle: string }): ReactNode {
  const [thread, setThread] = useState<ChatThread>({ kind: 'ai', id: undefined });
  return <ResizableSidebar label="Relay AI chat" className="assistant-sidebar">
    <header className="assistant-sidebar-head">
      <span className="assistant-sidebar-avatar"><Icon name="agent" size={28}/></span>
      <div><h2>Relay AI</h2><p>{subtitle}</p></div>
      <button type="button" className="assistant-sidebar-new" onClick={() => setThread({ kind: 'ai', id: null })} disabled={thread.id === null}>+ New chat</button>
    </header>
    <div className="chat-page-conversation assistant-sidebar-chat"><Conversation large privateOnly thread={thread} onThreadChange={setThread}/></div>
  </ResizableSidebar>;
}

/** A titled, collapsible block of a case sidebar; consecutive sections are divided by a rule. */
export function SidebarSection({ id, title, as, children }: { id: string; title: string; as?: 'h2' | 'h3'; children: ReactNode }): ReactNode {
  return <section className="case-sidebar-section" aria-labelledby={`${id}-title`}>
    <Collapsible id={id} headingId={`${id}-title`} title={title} as={as}>{children}</Collapsible>
  </section>;
}

/** The case checklist with a progress bar; each item can be ticked off. */
export function ChecklistSection({ id, checklist }: { id: string; checklist: CaseChecklist }): ReactNode {
  const { documents } = useCaseDocuments();
  const [showDone, setShowDone] = useState(false);
  const items = checklist.items ?? [];
  const open = items.filter((item) => item.state !== 'done');
  const finished = items.filter((item) => item.state === 'done');
  const doneCount = finished.length;
  const fileCount = documents?.length ?? 0;

  // Ticking an item removes it from the list; the toast offers an undo, and completed items stay one click away.
  const toggle = (item: ChecklistItem): void => {
    const done = item.state === 'done';
    void checklist.setState(item.id, done ? 'todo' : 'done').then(saved => {
      if (!saved) return;
      if (done) toast(`Reopened “${item.title}”`);
      else toast(`Done: ${item.title}`, 'success', { label: 'Undo', run: () => { void checklist.setState(item.id, item.state); } });
    });
  };
  const row = (item: ChecklistItem): ReactNode => {
    const done = item.state === 'done';
    return <li key={item.id} className={done ? 'is-done' : ''}>
      <button type="button" role="checkbox" aria-checked={done} aria-label={`${item.title}: mark ${done ? 'not done' : 'done'}`} className={`case-sidebar-check ${done ? 'is-done' : ''}`} onClick={() => toggle(item)}>{done ? '✓' : ''}</button>
      <span>{item.title}</span><small>{checklistLabels[item.state]}</small>
    </li>;
  };

  return <SidebarSection id={id} title="Checklist">
    <p className="case-sidebar-summary">{doneCount} of {items.length} done · {fileCount} file{fileCount === 1 ? '' : 's'} received</p>
    <div className="case-sidebar-progress" role="progressbar" aria-label="Checklist items done" aria-valuemin={0} aria-valuemax={items.length || 1} aria-valuenow={doneCount}><span style={{ width: `${items.length ? doneCount / items.length * 100 : 0}%` }}/></div>
    {checklist.error ? <p className="case-sidebar-empty" role="alert">{checklist.error}</p>
      : checklist.items === null ? <p className="case-sidebar-empty" role="status">Loading checklist…</p>
      : !items.length ? <p className="case-sidebar-empty">Relay adds items here as you chat about your packet. <Link to="/founder/chat#message-main">Start in AI Chat</Link></p>
      : <>
          {open.length ? <ul className="case-sidebar-checklist">{open.map(row)}</ul>
            : <p className="case-sidebar-empty">Everything on the checklist is done.</p>}
          {finished.length > 0 && <>
            <button type="button" className="case-sidebar-show-done" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} completed ({finished.length})</button>
            {showDone && <ul className="case-sidebar-checklist is-completed">{finished.map(row)}</ul>}
          </>}
        </>}
  </SidebarSection>;
}

/** The first open checklist item, plus links to the advisor's question and the packet versions. */
export function NextStepsSection({ id, checklist }: { id: string; checklist: CaseChecklist }): ReactNode {
  const { snapshot } = useRelay();
  const items = checklist.items ?? [];
  const nextItem = items.find((item) => item.state !== 'done');
  const latestPacket = useCasePackets().packets?.[0];
  const review = useReviewNotice(latestPacket);
  const openQuestions = review.visible && latestPacket?.review_decision === 'questions_returned';
  return <SidebarSection id={id} title="Next steps">
    {nextItem ? <div className="case-sidebar-next-step"><span className="case-sidebar-step-number">{items.indexOf(nextItem) + 1}</span><div><strong>{nextItem.title}</strong>{nextItem.detail && <p>{nextItem.detail}</p>}</div></div>
      : <p className="case-sidebar-empty">{items.length ? 'Everything on the checklist is done.' : 'Ask Relay what your packet needs to get started.'}</p>}
    {openQuestions && <Link className="case-sidebar-action" to="/founder/call">See {snapshot?.advisors[0]?.name ?? 'your advisor'}&apos;s questions</Link>}
    <Link className="case-sidebar-link" to="/founder/call">Review packet versions →</Link>
  </SidebarSection>;
}

/** The case activity feed: who did what, and when. */
export function ActivitySection({ id, title = 'Activity', limit, as }: { id: string; title?: string; limit?: number; as?: 'h2' | 'h3' }): ReactNode {
  const activity = useCaseActivity(undefined, limit);
  return <SidebarSection id={id} title={title} as={as}>
    {activity.error ? <p className="case-sidebar-empty" role="alert">{activity.error}</p>
      : activity.entries === null ? <p className="case-sidebar-empty" role="status">Loading activity…</p>
      : activity.entries.length ? <ul className="case-sidebar-feed">{activity.entries.map((entry) => <li key={entry.id}><strong>{actorLabels[entry.actor]}</strong><span>{entry.text}</span><small>{timeAgo(entry.created_at)}</small></li>)}</ul>
      : <p className="case-sidebar-empty">No activity yet. Uploads, checklist changes and Relay&apos;s work show up here.</p>}
  </SidebarSection>;
}

/** The latest messages across the role's conversations. */
export function RecentConversationSection({ id, limit = 3, as }: { id: string; limit?: number; as?: 'h2' | 'h3' }): ReactNode {
  const { snapshot, role } = useRelay();
  const messages = useRecentMessages(role, limit);
  const senderName = (sender: string): string | undefined =>
    sender === 'ai' ? 'Relay assistant' : sender === 'founder' ? snapshot?.founder.name : snapshot?.advisors[0]?.name;
  return <SidebarSection id={id} title="Recent conversation" as={as}>
    {messages?.length ? <ul className="case-sidebar-feed is-stacked">{messages.map((message) => <li key={message.id}><strong>{senderName(message.sender_type)}</strong><span className="case-sidebar-blurb">{plainText(message.content)}</span><small>{timeAgo(message.created_at)}</small></li>)}</ul>
      : <p className="case-sidebar-empty">{messages === null ? 'Loading…' : 'No conversation yet.'}</p>}
  </SidebarSection>;
}

/** The case's company, status and current packet. */
export function CaseDetailsSection({ id }: { id: string }): ReactNode {
  const { snapshot } = useRelay();
  const { packets } = useCasePackets();
  if (!snapshot) return null;
  const latest = packets?.[0];
  return <SidebarSection id={id} title="Case details">
    <dl className="case-sidebar-details">
      <div><dt>Name</dt><dd>{snapshot.company}</dd></div>
      <div><dt>Status</dt><dd>{latest ? packetStatus(latest).label : packets === null ? 'Loading…' : 'Gathering documents'}</dd></div>
      <div><dt>Packet</dt><dd>{latest ? <Link to="/founder/call">View packet v{latest.version}</Link> : 'No packet yet'}</dd></div>
    </dl>
  </SidebarSection>;
}

/** Call controls for the advisor, with the message thread to them below. */
function CallPanel({ onLiveCallChange }: { onLiveCallChange?: (active: boolean) => void }): ReactNode {
  const { snapshot } = useRelay();
  const [live, setLive] = useState(false);
  const other = snapshot?.advisors[0]?.name ?? 'your advisor';
  return <div className="case-sidebar-call">
    <CallControls onLiveActiveChange={(active) => { setLive(active); onLiveCallChange?.(active); }}/>
    {live ? <SidebarSection id="sidebar-call-messages" title="Messages"><Conversation humanOnly/></SidebarSection>
      : <SidebarSection id="sidebar-call-message" title={`Message ${other}`}><Conversation humanOnly startNew/></SidebarSection>}
  </div>;
}
