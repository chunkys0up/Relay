import { Link, useSearchParams } from 'react-router-dom';
import { BackendWorkspace } from '../workflow/BackendWorkspace';
import { Badge, Conversation, ScreenState, useRelay } from '@relay/shared';
import type { Task } from '@relay/shared';
import './styles.css';

const aiStates = ['Idle', 'Thinking / Working', 'Needs input'] as const;

function taskTone(task: Task): 'neutral' | 'attention' | 'success' {
  return task.state === 'Done' ? 'success' : task.state === 'Blocked' ? 'attention' : 'neutral';
}

function DemoScreen() {
  const { snapshot } = useRelay();
  const tasks = [...(snapshot?.tasks ?? [])].sort((a, b) => a.order - b.order);
  const sentClarification = snapshot?.clarifications.find((question) => question.packet_version_id === snapshot.current_packet_version_id && question.status === 'sent');
  const nextTask = tasks.find((task) => task.state !== 'Done');

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
      <section aria-labelledby="founder-chat-steps-title"><h2 id="founder-chat-steps-title">Your next steps</h2>
        {tasks.length ? <ol className="founder-chat-steps">{tasks.map((task) => <li key={task.id}><span className={`founder-chat-step-number ${task.state === 'Done' ? 'is-done' : ''}`}>{task.order}</span><div><strong>{task.title}</strong>{task.detail && <p>{task.detail}</p>}</div><Badge tone={taskTone(task)}>{task.state}</Badge></li>)}</ol> : <p className="founder-chat-empty">Tasks will appear as your packet work begins.</p>}
      </section>
      <section className="founder-chat-activity" aria-labelledby="founder-chat-activity-title"><h2 id="founder-chat-activity-title">Current activity</h2><p>{snapshot.activity ?? 'Waiting for your next step.'}</p>{nextTask && <small>Next task: {nextTask.title}</small>}</section>
      <section className="founder-chat-case" aria-labelledby="founder-chat-case-title"><h2 id="founder-chat-case-title">Case details</h2><dl><div><dt>Name</dt><dd>{snapshot.company}</dd></div><div><dt>Status</dt><dd>{snapshot.status}</dd></div><div><dt>AI state</dt><dd>{snapshot.ui_state}</dd></div><div><dt>Packet</dt><dd>{snapshot.current_packet_version_id ? <Link to={`/founder/documents?version=${encodeURIComponent(snapshot.current_packet_version_id)}`}>View current version</Link> : 'No draft yet'}</dd></div></dl></section>
    </aside>
  </div>}</ScreenState>;
}

export default function Screen() {
  const [params] = useSearchParams();
  if (params.get('workspace') === 'backend') return <BackendWorkspace view="chat" />;
  return <><div className="backend-workspace-entry"><Link to="/founder/chat?workspace=backend">Open backend packet workspace</Link><span>Separate development workspace · Bedrock configuration required</span></div><DemoScreen /></>;
}
