import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, CitationLink, Conversation, EmptyState, Icon, PageTitle, Panel, useDraft, useRelay } from '@relay/shared';
import './clarification.css';

function ConversationPanel(): ReactNode {
  return (
    <aside className="clarification-thread">
      <div className="clarification-thread-heading"><Icon name="agent" size={38}/><div><h2>Relay assistant</h2><small>Case messages</small></div></div>
      <Conversation humanOnly />
    </aside>
  );
}

export default function Screen(): ReactNode {
  const { snapshot, busy, run } = useRelay();
  const [answer, setAnswer] = useDraft('answer:' + (snapshot?.clarifications.filter(item => item.status === 'sent').at(-1)?.id ?? 'none'));
  const [previewing, setPreviewing] = useState(false);

  if (!snapshot) return null;

  const clarification = snapshot.clarifications.filter((item) => item.status === 'sent').at(-1);
  const packet = clarification
    ? snapshot.packets.find((item) => item.id === clarification.packet_version_id)
    : undefined;
  const questionMessage = clarification
    ? snapshot.messages.find((item) => item.id === clarification.message_id)
    : undefined;

  if (!clarification || !packet) {
    const answered = snapshot.clarifications.filter((item) => item.status === 'answered').at(-1);
    const newPacket = answered
      ? snapshot.packets.find((item) => item.previous_version_id === answered.packet_version_id)
      : undefined;

    const savedAnswer = newPacket?.citations.filter((citation) => citation.source_kind === 'message').map((citation) => snapshot.messages.find((message) => message.id === citation.source_id)).find((message) => message?.author.id === snapshot.founder.id);

    return (
      <section className="clarification-screen">
        <PageTitle title="Home conversation" subtitle="Packet questions and answers stay with your conversation." />
        <div className="workspace-grid clarification-layout">
          <Panel className="clarification-empty">
            {newPacket ? (
              <div className="clarification-outcome">
                <Badge tone="success">Draft v{newPacket.version} created · simulated</Badge>
                <h2>Your answer is in a proposed packet revision.</h2>
                <p>Your answer is saved in this local packet draft. Source conflicts stay visible for review. Case messages are stored separately.</p>
                {savedAnswer && <blockquote>{savedAnswer.text}</blockquote>}
                <div className="row wrap">
                  <Link className="button button-primary" to={`/founder/documents?version=${encodeURIComponent(newPacket.id)}`}>Review packet v{newPacket.version}</Link>
                  <Link className="button button-outline" to="/founder/home">Return to Home</Link>
                </div>
              </div>
            ) : answered && busy ? (
              <div role="status"><Badge>Thinking / Working</Badge><h2>Preparing your proposed revision</h2><p>Your answer is recorded in this simulated session. Relay is working on the next draft; it is not ready for review yet.</p></div>
            ) : (
              <EmptyState title="No clarification needs an answer">
                <p>When Maya sends a question about a shared packet, it will appear here in your Home conversation.</p>
                <Link className="button button-outline" to="/founder/home">Return to Home</Link>
              </EmptyState>
            )}
          </Panel>
          <ConversationPanel />
        </div>
      </section>
    );
  }

  const questionAuthor = questionMessage
    ? [snapshot.founder, ...snapshot.advisors].find((actor) => actor.id === questionMessage.author.id)
    : undefined;
  const authorName = questionMessage?.author.name ?? 'Assigned advisor';
  const authorLabel = questionMessage?.author.kind === 'ai'
    ? 'Relay assistant · AI'
    : questionAuthor?.role === 'advisor'
      ? 'Human advisor'
      : questionAuthor?.role === 'founder'
        ? 'Human founder'
        : 'Human participant';

  const previewAnswer = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (answer.trim() && !busy) setPreviewing(true);
  };

  const confirmAnswer = (): void => {
    if (!answer.trim() || busy) return;
    void run({
      kind: 'answer',
      expected_revision: snapshot.revision,
      packet_version_id: packet.id,
      packet_hash: clarification.packet_hash,
      clarification_id: clarification.id,
      clarification_revision: clarification.revision,
      text: answer.trim(),
    });
  };

  return (
    <section className="clarification-screen">
      <div className="clarification-breadcrumb"><Link to="/founder/home">Home</Link><span aria-hidden="true">/</span><span>Conversation</span></div>
      <PageTitle title="Clarify packet details" subtitle="Review Maya’s question, then preview your answer before creating a draft." />
      <div className="workspace-grid clarification-layout">
        <div className="clarification-main">
          <Panel className="clarification-question">
            <div className="clarification-question-head">
              <span className="clarification-person" aria-hidden="true">{authorName.split(' ').map((part) => part[0]).join('')}</span>
              <div><strong>{authorName}</strong><small>{authorLabel}{questionMessage ? ' · ' + new Date(questionMessage.created_at).toLocaleString() : ''}</small></div>
              <Badge tone="attention">Needs your input</Badge>
            </div>
            <h2>{clarification.text}</h2>
            <p className="muted">This question is tied to packet v{packet.version}. Your answer is added as a founder-attributed clarification; source conflicts remain visible for review.</p>
            <div className="clarification-citations" aria-label="Question sources">
              {clarification.citations.map((citation, index) => <CitationLink key={citation.source_id + citation.label + index} citation={citation} />)}
            </div>
          </Panel>

          <Panel className="clarification-answer" title="Your answer">
            <div className="clarification-answer-author" data-testid="clarification-answer-author"><span className="clarification-person founder-person" aria-hidden="true">AM</span><div><strong>{snapshot.founder.name}</strong><small>Draft · not sent</small></div></div>
            <form onSubmit={previewAnswer}>
              <label htmlFor="clarification-answer">Answer {authorName}’s question</label>
              <textarea id="clarification-answer" value={answer} maxLength={8000} placeholder="Type your answer…" onChange={(event) => { setAnswer(event.target.value); setPreviewing(false); }} disabled={busy} />
              <div className="clarification-form-footer"><p className="muted">Your response creates a proposed packet revision for review.</p><Button type="submit" disabled={busy || !answer.trim()}>Preview answer</Button></div>
            </form>
          </Panel>

          {previewing && answer.trim() && <Panel className="clarification-preview" title="Proposed packet change">
            <div className="clarification-version-change"><Badge>v{packet.version} · Current draft</Badge><span aria-hidden="true">→</span><Badge tone="attention">v{packet.version + 1} · Proposed draft</Badge></div>
            <div className="clarification-preview-columns"><div><strong>Current packet</strong><p>{packet.title} · v{packet.version}</p><small>Existing source facts and conflicts stay attached.</small></div><div><strong>Founder clarification</strong><p>{answer.trim()}</p><small>Synthetic, unverified answer attributed to {snapshot.founder.name}.</small></div></div>
            <p className="muted">No new version exists until you confirm. The source conflict remains visible in the proposed draft.</p>
            <div className="row wrap"><Button disabled={busy} onClick={confirmAnswer}>Create simulated draft v{packet.version + 1}</Button><Button variant="outline" disabled={busy} onClick={() => setPreviewing(false)}>Keep editing</Button></div>
          </Panel>}
        </div>
        <ConversationPanel />
      </div>
    </section>
  );
}
