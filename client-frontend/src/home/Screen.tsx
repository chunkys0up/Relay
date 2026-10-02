import { Link } from 'react-router-dom';
import { Badge, Conversation, EmptyState, Icon, PageTitle, Panel, ScreenState, useRelay } from '@relay/shared';
import type { Task } from '@relay/shared';
import './styles.css';

const aiStates = ['Idle', 'Thinking / Working', 'Needs input'] as const;

function taskLabel(task: Task): string {
  return task.state === 'In progress' ? 'In progress' : task.state;
}

export default function Screen() {
  const { snapshot } = useRelay();
  const currentFlags = snapshot?.flags.filter((flag) => flag.packet_version_id === snapshot.current_packet_version_id && !flag.resolved) ?? [];
  const sentClarification = snapshot?.clarifications.find((question) => question.packet_version_id === snapshot.current_packet_version_id && question.status === 'sent');

  return (
    <ScreenState>
      {snapshot && (
        <div className="founder-home">
          <PageTitle title={`Morning, ${snapshot.founder.name.split(' ')[0]}`} subtitle="Let’s get your founder packet ready.">
            <div className="founder-home-context">
              <span className="founder-home-avatar" aria-label={snapshot.founder.name}>AM</span>
              <span>{snapshot.founder.name} · Founder</span>
              <span className="founder-home-company-mark" aria-hidden="true">NL</span>
              <span>{snapshot.company} · Company profile</span>
            </div>
          </PageTitle>

          <div className="founder-home-grid">
            <div className="founder-home-main">
              <Panel className="founder-home-assistant">
                <div className="founder-home-ai-states" aria-label="Relay status">
                  {aiStates.map((state) => (
                    <span key={state} className={snapshot.ui_state === state ? 'is-current' : ''} aria-current={snapshot.ui_state === state ? 'step' : undefined}>
                      <span className="founder-home-state-dot" aria-hidden="true" />
                      {state}
                    </span>
                  ))}
                </div>
                <div className="founder-home-activity" role="status">
                  <span aria-hidden="true">◦</span>
                  <strong>Current activity</strong>
                  <span>{snapshot.activity ?? 'Waiting for your next step.'}</span>
                </div>
              </Panel>

              {snapshot.sources.length === 0 && snapshot.packets.length === 0 ? (
                <Panel><EmptyState title="Your workspace is ready"><p>Start in this conversation. Add source files locally in this browser. UTF-8 text and CSV previews are supported.</p></EmptyState><Conversation large allowUpload /></Panel>
              ) : (
                <Conversation large allowUpload />
              )}
            </div>

            <aside className="founder-home-aside" aria-label="Packet progress">
              <Panel className="founder-home-todo">
                <div className="founder-home-section-heading">
                  <h2>To-do</h2>
                  <Badge tone="attention">{snapshot.tasks.filter((task) => task.state === 'Blocked').length} need your input</Badge>
                </div>
                {snapshot.tasks.length === 0 ? (
                  <EmptyState title="No tasks yet"><p>Task updates will appear here after the workspace starts.</p></EmptyState>
                ) : (
                  <div className="founder-home-task-card">
                    <div className="founder-home-task-title">
                      <strong>Founder packet</strong>
                      <span>{snapshot.tasks.filter((task) => task.state === 'Done').length} of {snapshot.tasks.length} steps complete</span>
                    </div>
                    <div className="founder-home-progress" role="progressbar" aria-label="Founder packet tasks complete" aria-valuemin={0} aria-valuemax={snapshot.tasks.length} aria-valuenow={snapshot.tasks.filter((task) => task.state === 'Done').length}>
                      <span style={{ width: `${(snapshot.tasks.filter((task) => task.state === 'Done').length / snapshot.tasks.length) * 100}%` }} />
                    </div>
                    <p className="founder-home-case-status">Case status: {snapshot.status}</p>
                    <ol className="founder-home-tasks">
                      {snapshot.tasks.map((task) => (
                        <li key={task.id}>
                          <span className={`founder-home-task-mark state-${task.state.toLowerCase().replaceAll(' ', '-')}`} aria-hidden="true">{task.state === 'Done' ? '✓' : task.state === 'Blocked' ? '!' : '·'}</span>
                          <span className="founder-home-task-copy"><strong>{task.title}</strong>{task.detail && <small>{task.detail}</small>}</span>
                          <Badge tone={task.state === 'Blocked' ? 'attention' : task.state === 'Done' ? 'success' : 'neutral'}>{taskLabel(task)}</Badge>
                        </li>
                      ))}
                    </ol>
                    {snapshot.tasks.some((task) => task.state === 'Blocked') && (
                      <div className="founder-home-question">
                        <strong>Clarification needed</strong>
                        <p>{currentFlags.map((flag) => flag.text).join(' ') || 'Review the question in your conversation.'}</p>
                        {currentFlags.flatMap((flag) => flag.citations).filter((citation, index, all) => all.findIndex((item) => item.source_id === citation.source_id) === index).slice(0, 2).map((citation) => (
                          <Link className="founder-home-citation" key={`${citation.source_id}-${citation.label}`} to={`/founder/sources?source=${encodeURIComponent(citation.source_id)}`}>
                            <Icon name="file" size={18} />{citation.label}
                          </Link>
                        ))}
                        {sentClarification ? (
                          <Link className="button button-primary" to="/founder/home/clarification">Answer clarification in chat</Link>
                        ) : (
                          <>
                            <p className="founder-home-simulation-note">No advisor question has been sent yet. Add numeric revenue and reserve details in the existing private Home conversation to prepare a local draft. General simulated AI replies need the backend.</p>
                            <Link className="button button-primary" to="/founder/home#message-main">Answer in Home chat</Link>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Panel>

              <Panel className="founder-home-recent">
                <div className="founder-home-section-heading"><h2>Recent sources &amp; draft</h2><Link to="/founder/sources">View sources</Link></div>
                {snapshot.sources.length === 0 && snapshot.packets.length === 0 ? (
                  <p className="muted">Originals and drafts will appear here.</p>
                ) : (
                  <ul>
                    {snapshot.packets.slice(-1).map((packet) => (
                      <li key={packet.id}><Icon name="file" size={25} /><Link to={`/founder/documents?version=${packet.id}`}>{packet.title}</Link><small>Draft · {packet.status.replaceAll('_', ' ')}</small></li>
                    ))}
                    {snapshot.sources.slice(0, 3).map((source) => (
                      <li key={source.id}><Icon name="file" size={25} /><Link to={`/founder/sources?source=${source.id}`}>{source.name}</Link><small>Original · {source.extraction}</small></li>
                    ))}
                  </ul>
                )}
              </Panel>
            </aside>
          </div>
        </div>
      )}
    </ScreenState>
  );
}
