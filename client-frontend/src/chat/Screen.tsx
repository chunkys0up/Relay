import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Collapsible, Conversation, ScreenState, plainText, timeAgo, useCaseActivity, useCaseChecklist, useChats, useRelay } from '@relay/shared';
import type { ChatThread } from '../../../frontend-shared/src/conversation';
import type { ChecklistItem, ChecklistState } from '../../../frontend-shared/src/relayApi';
import './styles.css';

const stateLabels: Record<ChecklistState, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };

function itemTone(item: ChecklistItem): 'neutral' | 'attention' | 'success' {
  return item.state === 'done' ? 'success' : item.state === 'blocked' ? 'attention' : 'neutral';
}

function DemoScreen() {
  const { snapshot, role } = useRelay();
  const [params] = useSearchParams();
  const [thread, setThread] = useState<ChatThread>({ kind: params.get('audience') === 'human' ? 'human' : 'ai', id: undefined });
  const { chats, error: chatsError } = useChats(thread.kind, role);
  const activeId = thread.id === undefined ? chats?.[0]?.id ?? null : thread.id;
  const otherName = role === 'founder' ? snapshot?.advisors[0]?.name : snapshot?.founder.name;
  const checklist = useCaseChecklist();
  const activity = useCaseActivity(undefined, 4);
  const items = checklist.items ?? [];
  const sentClarification = snapshot?.clarifications.find((question) => question.packet_version_id === snapshot.current_packet_version_id && question.status === 'sent');
  const nextItem = items.find((item) => item.state !== 'done');

  return <ScreenState>{snapshot && <div className="founder-chat">
    <nav className="founder-chat-history" aria-label="Chat history">
      <div className="founder-chat-history-head">
        <h2>{thread.kind === 'ai' ? 'Chats with Relay' : `Chats with ${otherName ?? 'your advisor'}`}</h2>
        <button type="button" className="founder-chat-new" onClick={() => setThread({ kind: thread.kind, id: null })} aria-pressed={activeId === null}>+ New chat</button>
      </div>
      {chatsError ? <p className="founder-chat-history-empty" role="alert">{chatsError}</p>
        : chats === null ? <p className="founder-chat-history-empty" role="status">Loading chats…</p>
        : chats.length === 0 ? <p className="founder-chat-history-empty">No chats yet. Your conversations will be listed here.</p>
        : <ul>{chats.map(chat => <li key={chat.id}><button type="button" aria-current={chat.id === activeId ? 'true' : undefined} onClick={() => setThread({ kind: thread.kind, id: chat.id })}>
            <strong>{chat.title}</strong>
            {chat.last_content && <span>{plainText(chat.last_content)}</span>}
            <small>{timeAgo(chat.updated_at)}</small>
          </button></li>)}</ul>}
    </nav>
    <div className="founder-chat-main">
      <header className="founder-chat-header">
        <div><h1>AI Chat</h1><p>Prepare your packet with Relay</p></div>
      </header>
      <div className="founder-chat-conversation">
        {chats && chats.length > 0 && <label className="founder-chat-history-select">Chat<select value={activeId ?? ''} onChange={e => setThread({ kind: thread.kind, id: e.target.value || null })}><option value="">New chat</option>{chats.map(chat => <option key={chat.id} value={chat.id}>{chat.title}</option>)}</select></label>}
        <Conversation large thread={thread} onThreadChange={setThread}>
      {sentClarification && <section className="founder-chat-clarification" aria-label="Advisor question"><p>{snapshot.advisors[0]?.name ?? 'Your advisor'} sent you a question about your packet.</p><Link className="founder-chat-action" to="/founder/home/clarification">Answer the question</Link></section>}
</Conversation>
      </div>
    </div>
    <aside className="founder-chat-aside" aria-label="Planning steps and case details">
      <section aria-labelledby="founder-chat-steps-title"><Collapsible id="chat-checklist" headingId="founder-chat-steps-title" title="Checklist">
        {checklist.error ? <p className="founder-chat-empty" role="alert">{checklist.error}</p>
          : checklist.items === null ? <p className="founder-chat-empty" role="status">Loading checklist…</p>
          : items.length ? <ol className="founder-chat-steps">{items.map((item, index) => <li key={item.id}><span className={`founder-chat-step-number ${item.state === 'done' ? 'is-done' : ''}`}>{item.state === 'done' ? '✓' : index + 1}</span><div><strong>{item.title}</strong>{item.detail && <p>{item.detail}</p>}</div><Badge tone={itemTone(item)}>{stateLabels[item.state]}</Badge></li>)}</ol>
          : <p className="founder-chat-empty">Relay adds items here as you talk through your packet.</p>}
      </Collapsible></section>
      <section className="founder-chat-activity" aria-labelledby="founder-chat-activity-title"><Collapsible id="chat-activity" headingId="founder-chat-activity-title" title="Recent activity">
        {activity.entries?.length ? <ul className="founder-chat-activity-feed">{activity.entries.map((entry) => <li key={entry.id}><p>{entry.text}</p><small>{entry.actor === 'agent' ? 'Relay' : entry.actor === 'founder' ? 'You' : 'Advisor'} · {timeAgo(entry.created_at)}</small></li>)}</ul>
          : <p>{activity.error ?? (activity.entries === null ? 'Loading activity…' : 'Nothing yet.')}</p>}
        {nextItem && <small>Next: {nextItem.title}</small>}
      </Collapsible></section>
      <section className="founder-chat-case" aria-labelledby="founder-chat-case-title"><Collapsible id="chat-case" headingId="founder-chat-case-title" title="Case details"><dl><div><dt>Name</dt><dd>{snapshot.company}</dd></div><div><dt>Status</dt><dd>{snapshot.status}</dd></div><div><dt>Packet</dt><dd>{snapshot.current_packet_version_id ? <Link to={`/founder/documents?version=${encodeURIComponent(snapshot.current_packet_version_id)}`}>View current version</Link> : 'No draft yet'}</dd></div></dl></Collapsible></section>
    </aside>
  </div>}</ScreenState>;
}

export default function Screen() {
  return <DemoScreen />;
}
