import { Link, useSearchParams } from 'react-router-dom';
import { BackendWorkspace } from '../workflow/BackendWorkspace';
import { Badge, Collapsible, Conversation, ScreenState, timeAgo, useCaseActivity, useCaseChecklist, useRelay } from '@relay/shared';
import type { ChecklistItem, ChecklistState } from '../../../frontend-shared/src/relayApi';
import './styles.css';

const aiStates = ['Idle', 'Thinking / Working', 'Needs input'] as const;

const stateLabels: Record<ChecklistState, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' };

function itemTone(item: ChecklistItem): 'neutral' | 'attention' | 'success' {
  return item.state === 'done' ? 'success' : item.state === 'blocked' ? 'attention' : 'neutral';
}

function DemoScreen() {
  const { snapshot } = useRelay();
  const checklist = useCaseChecklist();
  const activity = useCaseActivity(undefined, 4);
  const items = checklist.items ?? [];
  const sentClarification = snapshot?.clarifications.find((question) => question.packet_version_id === snapshot.current_packet_version_id && question.status === 'sent');
  const nextItem = items.find((item) => item.state !== 'done');

  return <ScreenState>{snapshot && <div className="founder-chat">
    <div className="founder-chat-main">
      <header className="founder-chat-header">
        <div><h1>AI Chat</h1><p>Prepare your packet with Relay</p></div>
        <Badge tone={snapshot.ui_state === 'Needs input' ? 'attention' : 'neutral'}>{snapshot.ui_state}</Badge>
      </header>
      <div className="founder-chat-status" aria-label="Relay status">
        {aiStates.map((state) => <span key={state} aria-current={snapshot.ui_state === state ? 'step' : undefined} className={snapshot.ui_state === state ? 'is-current' : ''}><span aria-hidden="true"/>{state}</span>)}
      </div>
      <div className="founder-chat-conversation">
        <Conversation large>
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
      <section className="founder-chat-case" aria-labelledby="founder-chat-case-title"><Collapsible id="chat-case" headingId="founder-chat-case-title" title="Case details"><dl><div><dt>Name</dt><dd>{snapshot.company}</dd></div><div><dt>Status</dt><dd>{snapshot.status}</dd></div><div><dt>AI state</dt><dd>{snapshot.ui_state}</dd></div><div><dt>Packet</dt><dd>{snapshot.current_packet_version_id ? <Link to={`/founder/documents?version=${encodeURIComponent(snapshot.current_packet_version_id)}`}>View current version</Link> : 'No draft yet'}</dd></div></dl></Collapsible></section>
    </aside>
  </div>}</ScreenState>;
}

export default function Screen() {
  const [params] = useSearchParams();
  if (params.get('workspace') === 'backend') return <BackendWorkspace view="chat" />;
  return <><div className="backend-workspace-entry"><Link to="/founder/chat?workspace=backend">Open backend packet workspace</Link><span>Separate development workspace · Bedrock configuration required</span></div><DemoScreen /></>;
}
